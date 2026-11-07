package site.ycsb.db.DatabaseDrivers;


import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Session;
import org.neo4j.driver.Values;

public class Neo4jDriver implements DatabaseClient {
  String name;
  Driver neo4jDriver;
  Session session;

  /** Backtick-quotes a property key / label / edge type so it is safe to embed in Cypher. */
  private static String ident(String s) {
    return "`" + s.replace("`", "``") + "`";
  }

  @Override
  public void connect(String name, String URI) {
    try {
      this.name = name;
      this.neo4jDriver = GraphDatabase.driver(URI);
      this.session = neo4jDriver.session();
      neo4jDriver.verifyConnectivity();
    } catch (Exception e) {
      System.out.println("Failed to connect to Neo4j database: " + e.getMessage());
      throw new RuntimeException(e);
    }
  }

  @Override
  public boolean getVertexCount() {
      try {
          session.run("SHOW STORAGE INFO ON CURRENT DATABASE")
              .list(record -> record.get("storage info").asString().equals("vertex_count")
                  ? record.get("value").asLong()
                  : -1L)
              .stream()
              .filter(count -> count >= 0)
              .findFirst()
              .orElseThrow(() -> new RuntimeException("vertex_count not found"));

          return true;
      } catch (Exception e) {
          System.out.println("Exception in getVertexCount: " + e.getMessage());
          return false;
      }
  }


  @Override
  public boolean getEdgeCount() {
      try {
          session.run("SHOW STORAGE INFO ON CURRENT DATABASE")
              .list(record -> record.get("storage info").asString().equals("edge_count")
                  ? record.get("value").asLong()
                  : -1L)
              .stream()
              .filter(count -> count >= 0)
              .findFirst()
              .orElseThrow(() -> new RuntimeException("edge_count not found"));

          return true;
      } catch (Exception e) {
          System.out.println("Exception in getEdgeCount: " + e.getMessage());
          return false;
      }
  }

  @Override
  public boolean getEdgeLabels() {
      try {
          session.run("SHOW EDGE_TYPES INFO").consume();
          return true;
      } catch (Exception e) {
          System.out.println("Exception in getEdgeLabels: " + e.getMessage());
          return false;
      }
  }

  // The queries below are executed with consume(): session.run() alone only submits the query,
  // so without consuming the result the timing would not include fetching the records and
  // failures would not surface.
  @Override
  public boolean getVertexWithProperty(String key, String value) {
    try {
      session.run("MATCH (n) WHERE n." + ident(key) + " = $value RETURN n",
          Values.parameters("value", value)).consume();
      return true;
    } catch (Exception e) {
      System.out.println("Exception in getVertexWithProperty: " + e.getMessage());
      return false;
    }
  }

  @Override
  public boolean getEdgeWithProperty(String key, String value) {
    try {
      session.run("MATCH ()-[r]->() WHERE r." + ident(key) + " = $value RETURN r",
          Values.parameters("value", value)).consume();
      return true;
    } catch (Exception e) {
      System.out.println("Exception in getEdgeWithProperty: " + e.getMessage());
      return false;
    }
  }

  /** label is the edge type, i.e. the dataset's _label. */
  @Override
  public boolean getEdgesWithLabel(String label) {
    try {
      session.run("MATCH ()-[r:" + ident(label) + "]->() RETURN r").consume();
      return true;
    } catch (Exception e) {
      System.out.println("Exception in getEdgesWithLabel: " + e.getMessage());
      return false;
    }
  }
}