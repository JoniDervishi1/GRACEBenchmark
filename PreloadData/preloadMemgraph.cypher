// 1️⃣ Clear database
MATCH (n) DETACH DELETE n;



// Drop old indexes if they exist
DROP INDEX  ON :YCSBVertex;
DROP INDEX ON :YCSBEdge ;

// Create fresh indexes
CREATE EDGE INDEX ON :YCSBEdge;
CREATE INDEX ON :YCSBVertex;
CREATE INDEX ON :YCSBVertex(id);
CREATE INDEX ON :YCSBVertex(searchKey);
CREATE EDGE INDEX ON :YCSBEdge(id);
CREATE EDGE INDEX ON :YCSBEdge(_outV);
CREATE EDGE INDEX ON :YCSBEdge(_inV);
CREATE EDGE INDEX on :YCSBEdge(searchKey);





// 2️⃣ Load vertices
LOAD CSV FROM "/var/lib/memgraph/import/vertices.csv" WITH HEADER AS row
CREATE (n:YCSBVertex {id: row["_id"]})
SET n += row;  // all CSV columns become properties, including _id

// 3️⃣ Load edges
LOAD CSV FROM "/var/lib/memgraph/import/edges.csv" WITH HEADER AS row
MATCH (a:YCSBVertex {id: row["_outV"]}), (b:YCSBVertex {id: row["_inV"]})
CREATE (a)-[r:YCSBEdge {id: row["_id"]}]->(b)
SET r += row;   // copy all CSV columns as properties

// 4️⃣ Simple verification
MATCH (n:YCSBVertex) RETURN count(n) AS vertex_count;
MATCH ()-[r:YCSBEdge]->() RETURN count(r) AS edge_count;
