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


export class MemGraphDriver extends DatabaseDriver {
  driver;

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

  /** Runs a query that ends in "RETURN count(x) AS matched" and returns that number. */
  private async matched(query: string, params: object): Promise<number> {
    const result = await this.driver.executeQuery(query, params);
    const rec = result.records[0];
    return rec ? toNumber(rec.get("matched")) : 0;
  }

  async getGraph() {
    const query = `MATCH (n) RETURN n LIMIT 50`;

    try {
      return await this.driver.executeQuery(query);
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
    try {
      await this.driver.executeQuery(query, { properties: properties });
    } catch (err) {
      logger.error("Error in add vertex: " + err);
      throw err;
    }
  }

  async deleteVertex(id, labels?: any) {
    const query = `MATCH (n${labelClause(labels)} {id: $id}) DETACH DELETE n`;
    try {
      const result: any = await this.driver.executeQuery(query, { id: id });
      // Not thrown: a replicated delete of an already deleted vertex must stay a no-op.
      if (result?.summary?.counters?.updates?.()?.nodesDeleted === 0) {
        logger.error(`Delete vertex: no vertex with id ${id}${labelClause(labels)} found`);
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
    const query = `
          MATCH (a${labelClause(sourceLabels)} {${ident(sourcePropName)}: $sourcePropValue}),
                (b${labelClause(targetLabels)} {${ident(targetPropName)}: $targetPropValue})
          MERGE (a)-[r${typeClause(relationLabels)} {id: $properties.id}]->(b)
          SET r = $properties
          RETURN count(r) AS matched
    `;
    const params = {
      sourcePropValue: sourcePropValue,
      targetPropValue: targetPropValue,
      properties: properties,
    };

    try {
      if ((await this.matched(query, params)) === 0) {
        throw new Error(`Source or target vertex not found for edge ${properties.id}`);
      }
    } catch (err) {
      logger.error("Error in add edge: " + err);
      throw err;
    }
  }

  async deleteEdge(id: string, relationType?: any) {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $id}]->() DELETE r`;
    try {
      const result: any = await this.driver.executeQuery(query, { id: id });
      // Not thrown: a replicated delete of an already deleted edge must stay a no-op.
      if (result?.summary?.counters?.updates?.()?.relationshipsDeleted === 0) {
        logger.error(`Delete edge: no edge with id ${id}${typeClause(relationType)} found`);
      }
    } catch (err) {
      logger.error("Error in delete edge: " + err);
      throw err;
    }
  }

  async setVertexProperty(vid: string, key: string, value: string, labels?: any) {
    const query = `MATCH (n${labelClause(labels)} {id: $vid}) SET n.${ident(key)} = $value RETURN count(n) AS matched`;
    try {
      if ((await this.matched(query, { vid: vid, value: value })) === 0) {
        throw new Error(`Vertex with id ${vid} not found.`);
      }
      logger.info(`Property ${key} set to ${value} for vertex with id ${vid}`);
    } catch (err) {
      logger.error("Error in set vertex property: " + err);
      throw err;
    }
  }

  async setEdgeProperty(eid: string, key: string, value: string, relationType?: any) {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $eid}]->() SET r.${ident(key)} = $value RETURN count(r) AS matched`;
    try {
      if ((await this.matched(query, { eid: eid, value: value })) === 0) {
        throw new Error(`Edge with id ${eid} not found.`);
      }
      logger.info(`Property ${key} set to ${value} for edge with id ${eid}`);
    } catch (err) {
      logger.error("Error in set edge property: " + err);
      throw err;
    }
  }

  async removeVertexProperty(vid: string, key: string, labels?: any) {
    const query = `MATCH (n${labelClause(labels)} {id: $vid}) REMOVE n.${ident(key)} RETURN count(n) AS matched`;
    try {
      if ((await this.matched(query, { vid: vid })) === 0) {
        throw new Error(`Vertex with id ${vid} not found.`);
      }
      logger.info(`Property ${key} removed from vertex with id ${vid}`);
    } catch (err) {
      logger.error("Error in remove vertex property: " + err);
      throw err;
    }
  }

  async removeEdgeProperty(eid: string, key: string, relationType?: any) {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $eid}]->() REMOVE r.${ident(key)} RETURN count(r) AS matched`;
    try {
      if ((await this.matched(query, { eid: eid })) === 0) {
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