package site.ycsb.db;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import site.ycsb.DB;
import site.ycsb.DBException;
import site.ycsb.Status;
import site.ycsb.db.DatabaseDrivers.DatabaseClient;
import site.ycsb.db.DatabaseDrivers.DatabaseClientFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

public class GraceClient extends DB {

  /**
   * Keys that must never be sent as properties: the label columns of the dataset (they are the
   * vertex label / edge type, not properties) and "id", which is always set from the id argument.
   */
  private static final Set<String> RESERVED_KEYS = Set.of("id", "xlabel", "_label");

  private static HttpClient httpClient;
  private static Properties props = new Properties();
  private final Logger log = LoggerFactory.getLogger(getClass());
  private DatabaseClient dbDriver;

  public GraceClient() {
    System.out.println("GraceClient  Created");
  }

  @Override
  public void init() throws DBException {
    System.out.println("Starting GRACE client");
    props = getProperties();
    System.out.println(props);
    if (props.getProperty("HOSTURI") == null) {
      System.out.println("GRACE HOSTURI must be provided");
      throw new DBException("GRACE HOSTURI must be provided");
    }
    System.out.println("GRACE HOSTURI: " + props.getProperty("HOSTURI"));

    if (props.getProperty("DBTYPE") == null) {
      System.out.println("DBTYPE must be provided");
      throw new DBException("DBTYPE must be provided");
    }
    System.out.println("DBTYPE: " + props.getProperty("DBTYPE"));

    if (props.getProperty("DBURI") == null) {
      System.out.println("DBURI must be provided");
      throw new DBException("DBURI must be provided");
    }
    System.out.println("DBURI: " + props.getProperty("DBURI"));

    dbDriver = DatabaseClientFactory.getDatabaseClient(props.getProperty("DBTYPE"));
    dbDriver.connect(props.getProperty("DBTYPE"), props.getProperty("DBURI"));

    httpClient = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_1_1)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(5))
        .build();
  }

  // ---------- helpers ----------

  /** Escapes a string for use inside a JSON string literal. */
  private static String esc(String s) {
    if (s == null) {
      return "";
    }
    StringBuilder sb = new StringBuilder(s.length() + 8);
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
      case '"':  sb.append("\\\""); break;
      case '\\': sb.append("\\\\"); break;
      case '\n': sb.append("\\n"); break;
      case '\r': sb.append("\\r"); break;
      case '\t': sb.append("\\t"); break;
      case '\b': sb.append("\\b"); break;
      case '\f': sb.append("\\f"); break;
      default:
        if (c < 0x20) {
          sb.append(String.format("\\u%04x", (int) c));
        } else {
          sb.append(c);
        }
      }
    }
    return sb.toString();
  }

  /** Quoted and escaped JSON string. */
  private static String q(String s) {
    return "\"" + esc(s) + "\"";
  }

  /** {"k":"v", ..., "id":"<id>"} without the label keys. */
  private static String propertiesJson(Map<String, String> properties, String id) {
    StringBuilder sb = new StringBuilder("{");
    if (properties != null) {
      for (Map.Entry<String, String> entry : properties.entrySet()) {
        if (entry.getKey() == null || entry.getValue() == null || RESERVED_KEYS.contains(entry.getKey())) {
          continue;
        }
        sb.append(q(entry.getKey())).append(':').append(q(entry.getValue())).append(',');
      }
    }
    sb.append("\"id\":").append(q(id)).append('}');
    return sb.toString();
  }

  /** POSTs a JSON body to the GRACE API; OK only for a 2xx response. */
  private Status post(String path, String body) {
    try {
      HttpRequest request = HttpRequest.newBuilder()
          .uri(new URI(props.getProperty("HOSTURI") + path))
          .POST(HttpRequest.BodyPublishers.ofString(body))
          .header("Content-Type", "application/json")
          .build();
      HttpResponse<?> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
      int code = response.statusCode();
      return (code >= 200 && code < 300) ? Status.OK : Status.ERROR;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Status.ERROR;
    } catch (Exception e) {
      return Status.ERROR;
    }
  }

  // ---------- writes ----------

  /** label is the dataset's xlabel. */
  @Override
  public Status addVertex(String label, String id, Map<String, String> properties) {
    if (label == null || label.isEmpty()) {
      log.error("addVertex {} has no label", id);
      return Status.ERROR;
    }
    String reqBody = "{\"label\":[" + q(label) + "],\"properties\":" + propertiesJson(properties, id) + "}";
    return post("/api/addVertex", reqBody);
  }

  /** label is the dataset's _label. */
  @Override
  public Status addEdge(String label, String id, String from, String to, Map<String, String> properties) {
    if (label == null || label.isEmpty()) {
      log.error("addEdge {} has no label", id);
      return Status.ERROR;
    }
    String reqBody = "{\"sourcePropName\":\"id\""
        + ",\"sourcePropValue\":" + q(from)
        + ",\"targetPropName\":\"id\""
        + ",\"targetPropValue\":" + q(to)
        + ",\"relationType\":[" + q(label) + "]"
        + ",\"properties\":" + propertiesJson(properties, id) + "}";
    return post("/api/addEdge", reqBody);
  }

  @Override
  public Status setVertexProperty(String id, String key, String value) {
    return post("/api/setVertexProperty",
        "{\"id\":" + q(id) + ",\"key\":" + q(key) + ",\"value\":" + q(value) + "}");
  }

  @Override
  public Status setEdgeProperty(String id, String key, String value) {
    return post("/api/setEdgeProperty",
        "{\"id\":" + q(id) + ",\"key\":" + q(key) + ",\"value\":" + q(value) + "}");
  }

  @Override
  public Status removeVertex(String id) {
    return post("/api/deleteVertex", "{\"id\":" + q(id) + "}");
  }

  @Override
  public Status removeEdge(String id) {
    return post("/api/deleteEdge", "{\"id\":" + q(id) + "}");
  }

  @Override
  public Status removeVertexProperty(String id, String key) {
    return post("/api/removeVertexProperty", "{\"id\":" + q(id) + ",\"key\":" + q(key) + "}");
  }

  @Override
  public Status removeEdgeProperty(String id, String key) {
    return post("/api/removeEdgeProperty", "{\"id\":" + q(id) + ",\"key\":" + q(key) + "}");
  }

  // ---------- reads (executed directly against the underlying database) ----------

  @Override
  public Status getVertexCount() {
    return dbDriver.getVertexCount() ? Status.OK : Status.ERROR;
  }

  @Override
  public Status getEdgeCount() {
    return dbDriver.getEdgeCount() ? Status.OK : Status.ERROR;
  }

  @Override
  public Status getEdgeLabels() {
    return dbDriver.getEdgeLabels() ? Status.OK : Status.ERROR;
  }

  @Override
  public Status getVertexWithProperty(String key, String value) {
    return dbDriver.getVertexWithProperty(key, value) ? Status.OK : Status.ERROR;
  }

  @Override
  public Status getEdgeWithProperty(String key, String value) {
    return dbDriver.getEdgeWithProperty(key, value) ? Status.OK : Status.ERROR;
  }

  @Override
  public Status getEdgesWithLabel(String label) {
    return dbDriver.getEdgesWithLabel(label) ? Status.OK : Status.ERROR;
  }
}