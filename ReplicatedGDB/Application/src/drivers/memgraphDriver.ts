import { logger } from "../helpers/logging";
import { DatabaseDriver } from "./driver";
import neo4j from "neo4j-driver";
import { graph } from "../app";

/** Backtick-quotes a label, edge type or property key so it is safe to put in a query. */
const ident = (s: string) => "`" + String(s).replace(/`/g, "``") + "`";

/** ":`a`:`b`" for vertex labels, "" when the labels are not known. */
const labelClause = (labels?: string[]) =>
  labels && labels.length > 0 ? labels.map((l) => ":" + ident(l)).join("") : "";

/** ":`T`" for an edge type, "" when it is not known. A relationship has exactly one type. */
const typeClause = (types?: string[] | string) => {
  const t = Array.isArray(types) ? types[0] : types;
  return t ? ":" + ident(t) : "";
};

const toNumber = (v: any): number => (neo4j.isInt(v) ? v.toNumber() : Number(v));

/**
 * Vertices and edges keep the label / edge type they were loaded with (the dataset's xlabel and
 * _label), so every operation that targets an existing element takes that label from the caller
 * (Graph.ts knows it for each id). Putting the label in the pattern lets Memgraph use its
 * label(id) index. If nothing matches with the label, the query is repeated without it, and a
 * warning is logged for the first few times: that means the label Grace holds for the element
 * differs from the one stored in Memgraph, and the fallback is a full scan.
 *
 * The extra label / relationType parameters are typed any on purpose: DatabaseDriver declares these
 * methods with its own parameter lists (e.g. deleteEdge(properties, remote: boolean)), and a typed
 * extra parameter in the same position is rejected as incompatible (TS2416).
 */
export class MemGraphDriver extends DatabaseDriver {
  driver;
  private labelFallbacks = 0;

  constructor() {
    super();

    logger.info("Connecting to bolt on :", process.env.DATABASE_URI);
    this.driver = neo4j.driver(
      process.env.DATABASE_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
    );
    (async () => {
      await this.driver.getServerInfo();

      logger.info("Connected to the Database.");
    })();
  }

  private warnFallback(what: string, id: string, clause: string) {
    if (this.labelFallbacks++ < 5) {
      logger.info(
        `WARNING: ${what} ${id} not found with ${clause} but found without it. ` +
          `The label Grace holds differs from the one in Memgraph; this query was a full scan.`
      );
    }
  }

  /** Runs a query that ends in "RETURN count(x) AS matched" and returns that number. */
  private async matched(query: string, params: object): Promise<number> {
    const result = await this.driver.executeQuery(query, params);
    const rec = result.records[0];
    return rec ? toNumber(rec.get("matched")) : 0;
  }

  /** Runs build(clause); if nothing matched and a clause was used, runs build("") once more. */
  private async matchedWithFallback(
    what: string,
    id: string,
    clause: string,
    build: (clause: string) => string,
    params: object
  ): Promise<number> {
    let n = 0;
    if (clause) {
      n = await this.matched(build(clause), params);
    }
    if (n === 0) {
      n = await this.matched(build(""), params);
      if (n > 0 && clause) {
        this.warnFallback(what, id, clause);
      }
    }
    return n;
  }

  async getGraph() {
    const query = `MATCH (n) RETURN n LIMIT 50`;
    const params = null;

    try {
      const result = await this.driver.executeQuery(query);
      return result;
    } catch (err) {
      logger.error(err);
      throw err;
    }
  }

  async addVertex(labels, properties) {
    logger.info("Adding vertex");
    // MERGE ensures upsert behavior - matches CRDT semantics
    const query = `
      MERGE (n${labelClause(labels)} {id: $properties.id})
      SET n = $properties
    `;
    const params = { properties: properties };
    try {
      await this.driver.executeQuery(query, params);
    } catch (err) {
      logger.error("Error in add vertex: " + err);
      throw err;
    }
  }

  async deleteVertex(id, labels?: any) {
    const clause = labelClause(labels);
    const build = (c: string) => `MATCH (n${c} {id: $id}) DETACH DELETE n`;
    const params = { id: id };
    const deleted = (r: any) => r?.summary?.counters?.updates?.()?.nodesDeleted;

    try {
      let result = await this.driver.executeQuery(build(clause), params);
      if (clause && deleted(result) === 0) {
        result = await this.driver.executeQuery(build(""), params);
        if (deleted(result) > 0) {
          this.warnFallback("vertex", id, clause);
        }
      }
    } catch (err) {
      logger.error("Error in delete vertex: " + err);
      throw err;
    }
  }

  async addEdge(
    relationLabels: [string],
    sourcePropName: string,
    sourcePropValue: any,
    targetPropName: string,
    targetPropValue: any,
    properties: { [key: string]: any },
    sourceLabels?: any,
    targetLabels?: any
  ) {
    // MERGE ensures upsert behavior for edges too. The endpoints carry their own labels so the
    // label(id) index is used.
    const build = (sc: string, tc: string) => `
          MATCH (a${sc} {${ident(sourcePropName)}: $sourcePropValue}),
                (b${tc} {${ident(targetPropName)}: $targetPropValue})
          MERGE (a)-[r${typeClause(relationLabels)} {id: $properties.id}]->(b)
          SET r = $properties
          RETURN count(r) AS matched
    `;
    const params = {
      sourcePropValue: sourcePropValue,
      targetPropValue: targetPropValue,
      properties: properties,
    };
    const sc = labelClause(sourceLabels);
    const tc = labelClause(targetLabels);

    try {
      let n = 0;
      if (sc || tc) {
        n = await this.matched(build(sc, tc), params);
      }
      if (n === 0) {
        n = await this.matched(build("", ""), params);
        if (n > 0 && (sc || tc)) {
          this.warnFallback("edge endpoints", `${sourcePropValue}->${targetPropValue}`, sc + "/" + tc);
        }
      }
      if (n === 0) {
        // Before this check a missing endpoint silently created nothing.
        throw new Error(`Source or target vertex not found for edge ${properties.id}`);
      }
    } catch (err) {
      logger.error("Error in add edge: " + err);
      throw err;
    }
  }

  async deleteEdge(id: string, relationType?: any) {
    const clause = typeClause(relationType);
    const build = (c: string) => `MATCH ()-[r${c} {id: $id}]->() DELETE r`;
    const params = { id: id };
    const deleted = (r: any) => r?.summary?.counters?.updates?.()?.relationshipsDeleted;

    logger.info("Delete edge query: " + build(clause));
    try {
      let result = await this.driver.executeQuery(build(clause), params);
      if (clause && deleted(result) === 0) {
        result = await this.driver.executeQuery(build(""), params);
        if (deleted(result) > 0) {
          this.warnFallback("edge", id, clause);
        }
      }
    } catch (err) {
      logger.error("Error in delete edge: " + err);
      throw err;
    }
  }

  async setVertexProperty(vid: string, key: string, value: string, labels?: any) {
    const build = (c: string) =>
      `MATCH (n${c} {id: $vid}) SET n.${ident(key)} = $value RETURN count(n) AS matched`;

    try {
      const n = await this.matchedWithFallback("vertex", vid, labelClause(labels), build, {
        vid: vid,
        value: value,
      });
      if (n === 0) {
        throw new Error(`Vertex with id ${vid} not found.`);
      }
      logger.info(`Property ${key} set to ${value} for vertex with id ${vid}`);
    } catch (err) {
      logger.error("Error in set vertex property: " + err);
      throw err;
    }
  }

  async setEdgeProperty(eid: string, key: string, value: string, relationType?: any) {
    const build = (c: string) =>
      `MATCH ()-[r${c} {id: $eid}]->() SET r.${ident(key)} = $value RETURN count(r) AS matched`;

    try {
      const n = await this.matchedWithFallback("edge", eid, typeClause(relationType), build, {
        eid: eid,
        value: value,
      });
      if (n === 0) {
        throw new Error(`Edge with id ${eid} not found.`);
      }
      logger.info(`Property ${key} set to ${value} for edge with id ${eid}`);
    } catch (err) {
      logger.error("Error in set edge property: " + err);
      throw err;
    }
  }

  async removeVertexProperty(vid: string, key: string, labels?: any) {
    const build = (c: string) =>
      `MATCH (n${c} {id: $vid}) REMOVE n.${ident(key)} RETURN count(n) AS matched`;

    try {
      const n = await this.matchedWithFallback("vertex", vid, labelClause(labels), build, {
        vid: vid,
      });
      if (n === 0) {
        throw new Error(`Vertex with id ${vid} not found.`);
      }
      logger.info(`Property ${key} removed from vertex with id ${vid}`);
    } catch (err) {
      logger.error("Error in remove vertex property: " + err);
      throw err;
    }
  }

  async removeEdgeProperty(eid: string, key: string, relationType?: any) {
    const build = (c: string) =>
      `MATCH ()-[r${c} {id: $eid}]->() REMOVE r.${ident(key)} RETURN count(r) AS matched`;

    try {
      const n = await this.matchedWithFallback("edge", eid, typeClause(relationType), build, {
        eid: eid,
      });
      if (n === 0) {
        throw new Error(`Edge with id ${eid} not found.`);
      }
      logger.info(`Property ${key} removed from edge with id ${eid}`);
    } catch (err) {
      logger.error("Error in remove edge property: " + err);
      throw err;
    }
  }

  async *streamQuery(session: any, query: string, batchSize: number = 10000) {
    let skip = 0;
    while (true) {
      const result = await this.driver.executeQuery(
        `${query} SKIP $skip LIMIT $limit`,
        { skip: neo4j.int(skip), limit: neo4j.int(batchSize) }
      );

      if (result.records.length === 0) break;

      yield result.records; // yield a batch of records
      skip += batchSize;
    }
  }
}