import { logger } from "../helpers/logging";
import { DatabaseDriver } from "./driver";
import neo4j from "neo4j-driver";

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


  async addVertex(labels, properties): Promise<Boolean> {
    logger.info("Adding vertex");
    try {
      logger.debug(JSON.stringify(labels));

      const query = `
        MERGE (n${labelClause(labels)} {id: $properties.id})
        SET n = $properties
      `;

      const params = { properties: properties };
      logger.debug("Add vertex query string: " + query);
      const result = await this.driver.executeQuery(query, params);

      if (result.records && result.records.length === 0) {
        return Promise.resolve(false);
      }
      //logger.info("Vertex added with labels: " + labelString);
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in add vertex: " + err);
      return Promise.resolve(Promise.resolve(false));
    }
  }

  async deleteVertex(id, labels?: any): Promise<Boolean> {
    try {
      logger.info("Deleting vertex with id: " + id);
      const query = `MATCH (n${labelClause(labels)} {id: $id}) DETACH DELETE n`;
      logger.debug("Delete vertex query: " + query);
      const result = await this.driver.executeQuery(query, { id: id });
      // logger.info(JSON.stringify(result));
      if (result.summary.counters._stats.nodesDeleted == 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in delete vertex: " + err);
      return Promise.resolve(false);
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
  ): Promise<Boolean> {
    const relationLabelString = relationLabels.join(":");

    const query = `
          MATCH (a${labelClause(sourceLabels)} {${ident(sourcePropName)}: $sourcePropValue}),
                (b${labelClause(targetLabels)} {${ident(targetPropName)}: $targetPropValue})
          MERGE (a)-[r${typeClause(relationLabels)} {id: $properties.id}]->(b)
          SET r = $properties
          RETURN count(r) AS matched
    `;

    const params = {
      sourcePropName: sourcePropName,
      sourcePropValue: sourcePropValue,
      targetPropName: targetPropName,
      targetPropValue: targetPropValue,
      properties: properties,
    };

    try {
      const result = await this.driver.executeQuery(query, params);
      if (result.records && result.records.length === 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in add edge: " + err);
      return Promise.resolve(false);
    }
  }

  async deleteEdge(id: string, relationType?: any): Promise<Boolean> {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $id}]->() DELETE r`;
    logger.info("Delete edge query: " + query);
    try {
      const result = await this.driver.executeQuery(query, { id: id });
      logger.info(JSON.stringify(result));
      if (result.summary.counters._stats.relationshipsDeleted == 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in delete edge: " + err);
      return Promise.resolve(false);
    }
  }

  async setVertexProperty(
    vid: string,
    key: string,
    value: string,
    labels?: any
  ): Promise<Boolean> {
    const query = `MATCH (n${labelClause(labels)} {id: $vid}) SET n.${ident(key)} = $value RETURN count(n) AS matched`;

    try {
      const result = await this.driver.executeQuery(query, { vid: vid, value: value });
      if (result.records.length === 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in set vertex property: " + err);
      return Promise.resolve(false);
    }
  }
  async setEdgeProperty(
    eid: string,
    key: string,
    value: string,
    relationType?: any
  ): Promise<Boolean> {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $eid}]->() SET r.${ident(key)} = $value RETURN count(r) AS matched`;

    try {
      const result = await this.driver.executeQuery(query,  { eid: eid, value: value });
      if (result.records && result.records.length === 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in set edge property: " + err);
      return Promise.resolve(false);
    }
  }

  async removeVertexProperty(vid: string, key: string, labels?: any): Promise<Boolean> {
    const query = `MATCH (n${labelClause(labels)} {id: $vid}) REMOVE n.${ident(key)} RETURN count(n) AS matched`;
    try {
      const result = await this.driver.executeQuery(query, { vid: vid });
      if (result.records && result.records.length == 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in remove vertex property: " + err);
      return Promise.resolve(false);
    }
  }

  async removeEdgeProperty(eid: string, key: string, relationType?: any): Promise<Boolean> {
    const query = `MATCH ()-[r${typeClause(relationType)} {id: $eid}]->() REMOVE r.${ident(key)} RETURN count(r) AS matched`;

    try {
      const result = await this.driver.executeQuery(query, { eid: eid });
      if (result.records && result.records.length == 0) {
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    } catch (err) {
      logger.error("Error in remove edge property: " + err);
      return Promise.resolve(false);
    }
  }

  async *streamQuery(session: any, query: string, batchSize: number = 10000) {
    let skip = 0;
    while (Promise.resolve(true)) {
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
