/**
 * Copyright (c) 2010 Yahoo! Inc., Copyright (c) 2016-2020 YCSB contributors. All rights reserved.
 * <p>
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You
 * may obtain a copy of the License at
 * <p>
 * http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License. See accompanying
 * LICENSE file.
 */

package site.ycsb.workloads;

import org.apache.htrace.shaded.fasterxml.jackson.core.JsonFactory;
import org.apache.htrace.shaded.fasterxml.jackson.core.JsonParser;
import org.apache.htrace.shaded.fasterxml.jackson.core.JsonToken;
import site.ycsb.*;
import site.ycsb.generator.*;
import site.ycsb.generator.UniformLongGenerator;
import site.ycsb.measurements.Measurements;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

/**
 * The core benchmark scenario. Represents a set of clients doing simple CRUD operations. The
 * relative proportion of different kinds of operations, and other properties of the workload,
 * are controlled by parameters specified at runtime.
 * <p>
 * Properties to control the client:
 * <UL>
 * <LI><b>fieldcount</b>: the number of fields in a record (default: 10)
 * <LI><b>fieldlength</b>: the size of each field (default: 100)
 * <LI><b>minfieldlength</b>: the minimum size of each field (default: 1)
 * <LI><b>readallfields</b>: should reads read all fields (true) or just one (false) (default: true)
 * <LI><b>writeallfields</b>: should updates and read/modify/writes update all fields (true) or just
 * one (false) (default: false)
 * <LI><b>readproportion</b>: what proportion of operations should be reads (default: 0.95)
 * <LI><b>updateproportion</b>: what proportion of operations should be updates (default: 0.05)
 * <LI><b>insertproportion</b>: what proportion of operations should be inserts (default: 0)
 * <LI><b>scanproportion</b>: what proportion of operations should be scans (default: 0)
 * <LI><b>readmodifywriteproportion</b>: what proportion of operations should be read a record,
 * modify it, write it back (default: 0)
 * <LI><b>requestdistribution</b>: what distribution should be used to select the records to operate
 * on - uniform, zipfian, hotspot, sequential, exponential or latest (default: uniform)
 * <LI><b>minscanlength</b>: for scans, what is the minimum number of records to scan (default: 1)
 * <LI><b>maxscanlength</b>: for scans, what is the maximum number of records to scan (default: 1000)
 * <LI><b>scanlengthdistribution</b>: for scans, what distribution should be used to choose the
 * number of records to scan, for each scan, between 1 and maxscanlength (default: uniform)
 * <LI><b>insertstart</b>: for parallel loads and runs, defines the starting record for this
 * YCSB instance (default: 0)
 * <LI><b>insertcount</b>: for parallel loads and runs, defines the number of records for this
 * YCSB instance (default: recordcount)
 * <LI><b>zeropadding</b>: for generating a record sequence compatible with string sort order by
 * 0 padding the record number. Controls the number of 0s to use for padding. (default: 1)
 * For example for row 5, with zeropadding=1 you get 'user5' key and with zeropading=8 you get
 * 'user00000005' key. In order to see its impact, zeropadding needs to be bigger than number of
 * digits in the record number.
 * <LI><b>insertorder</b>: should records be inserted in order by key ("ordered"), or in hashed
 * order ("hashed") (default: hashed)
 * <LI><b>fieldnameprefix</b>: what should be a prefix for field names, the shorter may decrease the
 * required storage size (default: "field")
 * </ul>
 */
public class CoreWorkload extends Workload {
  /**
   * The name of the database table to run queries against.
   */
  public static LinkedList<String> loadedVertices = new LinkedList<>();
  public static LinkedList<String> loadedEdges = new LinkedList<>();

  public static LinkedList<String> insertedVertices = new LinkedList<>();
  public static LinkedList<String> insertedEdges = new LinkedList<>();

  // Read-only snapshots of the loaded ids (built in init) used to pick a random id per operation.
  // LinkedList.get(i) is O(n) and getFirst() always hits the same record, so these are ArrayLists.
  private List<String> loadedVertexIds = new ArrayList<>();
  private List<String> loadedEdgeIds = new ArrayList<>();

  // Edge types (the dataset's _label values) used by GET_EDGES_WITH_LABEL.
  private List<String> edgeLabels = new ArrayList<>();

  // Counters for the load phase (so silently failed inserts are visible).
  private long vertexLoadOk, vertexLoadFailed, edgeLoadOk, edgeLoadFailed;

  private static String randomId(List<String> ids) {
    if (ids.isEmpty()) {
      return null;
    }
    return ids.get(ThreadLocalRandom.current().nextInt(ids.size()));
  }

  /**
   * Reads the edge type names from the "labels" object of Edges.labels.json, which jsontoCSV.py
   * writes as <dataset>_load_edges.labels.json and RunBenchmark.sh copies into the YCSB directory.
   */
  private static List<String> loadEdgeLabels(String path) throws WorkloadException {
    List<String> labels = new ArrayList<>();
    File f = new File(path);
    if (!f.exists()) {
      throw new WorkloadException("Edge labels file not found: " + f.getAbsolutePath()
          + " (copy <dataset>_load_edges.labels.json to it; see RunBenchmark.sh)");
    }
    try (JsonParser parser = new JsonFactory().createParser(f)) {
      JsonToken tok;
      while ((tok = parser.nextToken()) != null) {
        if (tok == JsonToken.FIELD_NAME && "labels".equals(parser.getCurrentName())) {
          if (parser.nextToken() != JsonToken.START_OBJECT) {
            break;
          }
          while (parser.nextToken() == JsonToken.FIELD_NAME) {
            labels.add(parser.getCurrentName());
            parser.nextToken();
            parser.skipChildren();
          }
          break;
        }
      }
    } catch (IOException e) {
      throw new WorkloadException("Failed to read " + path + ": " + e.getMessage());
    }
    if (labels.isEmpty()) {
      throw new WorkloadException("No edge labels found in " + path);
    }
    return labels;
  }


  /**
   * The name of the property for the proportion of transactions that are reads.
   */
  public static final String CREATE_PROPORTION_PROPERTY = "createproportion";

  /**
   * The default proportion of transactions that are reads.
   */
  public static final String CREATE_PROPORTION_PROPERTY_DEFAULT = "0.95";
  /**
   * The name of the property for the proportion of transactions that are scans.
   */
  public static final String READ_PROPORTION_PROPERTY = "readproportion";

  /**
   * The default proportion of transactions that are scans.
   */
  public static final String READ_PROPORTION_PROPERTY_DEFAULT = "0.0";
  /**
   * The name of the property for the proportion of transactions that are updates.
   */
  public static final String UPDATE_PROPORTION_PROPERTY = "updateproportion";

  /**
   * The default proportion of transactions that are updates.
   */
  public static final String UPDATE_PROPORTION_PROPERTY_DEFAULT = "0.05";

  /**
   * The name of the property for the proportion of transactions that are inserts.
   */
  public static final String DELETE_PROPORTION_PROPERTY = "deleteproportion";

  /**
   * The default proportion of transactions that are inserts.
   */
  public static final String DELETE_PROPORTION_PROPERTY_DEFAULT = "0.0";

  protected DiscreteGenerator operationchooser;

  private RandomPropertyGenerator propertyPool = new RandomPropertyGenerator(1000, 8); // 1000 random strings, each length 8



  public void ProcessVertexFile(DB db, Properties props) throws IOException{
    String vertexFile = props.getProperty("loadVertexFile", "UNDEF");
    if ("UNDEF".equals(vertexFile)){
      throw new RuntimeException("Vertex file not supplied in parameters");
    }
    System.out.println("Loading vertex data from: "+ vertexFile);
    JsonFactory factory = new JsonFactory();
    File file = new File(vertexFile);
    long totalBytes = file.length();
    try (JsonParser parser = factory.createParser(file)) {
      if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new IOException("Expected JSON array");
      }

      while (parser.nextToken() == JsonToken.START_OBJECT) {
        String id = null;
        String label = null;   // the dataset's xlabel
        Map<String, String> properties = new HashMap<>();

        while (parser.nextToken() != JsonToken.END_OBJECT) {
          String fieldName = parser.getCurrentName();
          parser.nextToken();
          String value = parser.getValueAsString();

          switch (fieldName) {
            case "_id":
              id = value;
              break;
            case "xlabel":
              label = value;
              break;
            default:
              properties.put(fieldName, value);
              break;
          }

        }
        if (id == null || label == null || label.isEmpty()) {
          vertexLoadFailed++;
          continue;
        }
        properties.put("searchKey", propertyPool.next());
        Status status = db.addVertex(label, id, properties);
        if (status != null && status.isOk()) {
          appendVertexID(id);   // only ids that were really added
          vertexLoadOk++;
        } else {
          vertexLoadFailed++;
        }

//        // --- Progress bar ---
//        long currentBytes = parser.getCurrentLocation().getByteOffset();
//        int percent = (int) ((currentBytes * 100.0) / totalBytes);
//        System.out.printf("\rVertices load progress: %d%%", percent);

//        // Example: store ID for fast lookup and keep properties in memory only if needed
//        if (id != null) {
//          loadedVertices.add(id);  // IDs used for reads
//          updateVertexIds.add(id);   // IDs used for deletes
//        }

        // Properties map can be used immediately or stored somewhere
        // e.g., db.addVertex(table, id, properties);
      }
    }
  }



  public void ProcessEdgeFile(DB db, Properties props) throws IOException{
    String edgeFile = props.getProperty("loadEdgeFile", "UNDEF");
    if ("UNDEF".equals(edgeFile)){
      throw new RuntimeException("Edge file not supplied in parameters");
    }
    System.out.println("Loading edge data from: "+ edgeFile);
    JsonFactory factory = new JsonFactory();
    File file = new File(edgeFile);
    long totalBytes = file.length();
    try (JsonParser parser = factory.createParser(file)) {
      if (parser.nextToken() != JsonToken.START_ARRAY) {
        throw new IOException("Expected JSON array");
      }

      while (parser.nextToken() == JsonToken.START_OBJECT) {
        String id = null;
        String label = null;   // the dataset's _label
        String from = null;
        String to= null;
        Map<String, String> properties = new HashMap<>();

        while (parser.nextToken() != JsonToken.END_OBJECT) {
          String fieldName = parser.getCurrentName();
          parser.nextToken();
          String value = parser.getValueAsString();

          switch (fieldName) {
            case "_id":
              id = value;
              break;
            case "_label":
              label = value;
              break;
            case "_outV":
              from = value;
              break;
            case "_inV":
              to = value;
              break;
            default:
              properties.put(fieldName, value);
              break;
          }

        }
        if (id == null || label == null || label.isEmpty() || from == null || to == null) {
          edgeLoadFailed++;
          continue;
        }
        properties.put("searchKey", propertyPool.next());
        Status status = db.addEdge(label, id, from, to, properties);
        if (status != null && status.isOk()) {
          appendEdgeID(id);   // only ids that were really added
          edgeLoadOk++;
        } else {
          edgeLoadFailed++;
        }
//
//        // --- Progress bar ---
//        long currentBytes = parser.getCurrentLocation().getByteOffset();
//        int percent = (int) ((currentBytes * 100.0) / totalBytes);
//        System.out.printf("\rEdges load progress: %d%%", percent);

//        // Example: store ID for fast lookup and keep properties in memory only if needed
//        if (id != null) {
//          loadedVertices.add(id);  // IDs used for reads
//          updateVertexIds.add(id);   // IDs used for deletes
//        }

        // Properties map can be used immediately or stored somewhere
        // e.g., db.addVertex(table, id, properties);
      }
    }
  }



  @Override
  public void loadData(DB db, Properties props) {
    try {
      vertexWriter = new BufferedWriter(new FileWriter("./Vertices.loaded", false));
      edgeWriter = new BufferedWriter(new FileWriter("./Edges.loaded", false));

    } catch (IOException e) {
      throw new RuntimeException("Failed to open ID files for writing", e);
    }

    System.out.println("Called load data in core workload. Loading data");
    try {
      ProcessVertexFile(db, props);
      System.out.printf("Vertices: %d added, %d failed or skipped%n", vertexLoadOk, vertexLoadFailed);
      ProcessEdgeFile(db, props);
      System.out.printf("Edges: %d added, %d failed or skipped%n", edgeLoadOk, edgeLoadFailed);
    } catch (Exception e)
    {
      System.out.println("Error loading data.");
      e.printStackTrace();
    } finally {
        closeWriters(); // <- flush & close buffers
      }
    }

  private BufferedWriter vertexWriter;
  private BufferedWriter edgeWriter;

  private void appendVertexID(String id) {
    try {
      vertexWriter.write(id);
      vertexWriter.newLine();
    } catch (IOException e) {
      System.err.println("Failed to write vertex ID: " + id);
      e.printStackTrace();
    }
  }

  private void appendEdgeID(String id) {
    try {
      edgeWriter.write(id);
      edgeWriter.newLine();
    } catch (IOException e) {
      System.err.println("Failed to write edge ID: " + id);
      e.printStackTrace();
    }
  }

  public void closeWriters() {
    try {
      if (vertexWriter != null) {
        vertexWriter.flush();
        vertexWriter.close();
        vertexWriter = null;
      }
      if (edgeWriter != null) {
        edgeWriter.flush();
        edgeWriter.close();
        edgeWriter = null;
      }
    } catch (IOException e) {
      e.printStackTrace();
    }
  }
  private static LinkedList<String> loadIDs(String filename) {
    LinkedList<String> ids = new LinkedList<>();
    java.io.File file = new java.io.File(filename);
    if(file.exists()) {
      try(java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader(file))) {
        String line;
        while((line = br.readLine()) != null) {
          ids.add(line.trim());
        }
      } catch(Exception e) {
        System.err.println("Failed to load IDs from " + filename);
        e.printStackTrace();
      }
    }
    return ids;
  }

  private JsonObjectStreamer vertexStreamer;
  private JsonObjectStreamer edgeStreamer;


  @Override
  public void init(Properties p) throws WorkloadException {

    operationchooser = createOperationGenerator(p);
    // Load previously inserted IDs (if files exist)
    loadedVertices = loadIDs("./Vertices.loaded");
    loadedEdges = loadIDs("./Edges.loaded");
    System.out.printf("Loaded %d vertices and %d edges%n", loadedVertices.size(), loadedEdges.size());
    loadedVertexIds = new ArrayList<>(loadedVertices);
    loadedEdgeIds = new ArrayList<>(loadedEdges);
    edgeLabels = loadEdgeLabels(p.getProperty("edgeLabelsFile", "./Edges.labels.json"));
    System.out.println("Edge labels: " + edgeLabels);

    try{
      if(p.getProperty("vertexAddFile") == null){
        throw new WorkloadException("vertexAddFile must be provided for the update workload");
      }
      if(p.getProperty("edgeAddFile") == null){
        throw new WorkloadException("edgeAddFile must be provided for the update workload");
      }
      vertexStreamer = new JsonObjectStreamer(p.getProperty("vertexAddFile"));
      edgeStreamer = new JsonObjectStreamer(p.getProperty("edgeAddFile"));

    } catch (IOException e){
      throw new WorkloadException("Failed to open update workload");
    }

  }

  /**
   * Do one transaction operation. Because it will be called concurrently from multiple client
   * threads, this function must be thread safe. However, avoid synchronized, or the threads will block waiting
   * for each other, and it will be difficult to reach the target throughput. Ideally, this function would
   * have no side effects other than DB operations.
   */
  @Override
  public boolean doTransaction(DB db, Object threadstate) {
    String operation = operationchooser.nextString();
    // System.out.println("Selected operation: " + operation);
    if(operation == null) {
      return false;
    }

    switch (operation) {
      case "ADD_VERTEX":
        doTransactionAddVertex(db);
        break;
      case "ADD_EDGE":
        doTransactionAddEdge(db);
        break;
      case "GET_VERTEX_COUNT":
        doTransactionGetVertexCount(db);
        break;
      case "GET_EDGE_COUNT":
        doTransactionGetEdgeCount(db);
        break;
      case "GET_EDGE_LABELS":
        doTransactionGetEdgeLabels(db);
        break;
      case "GET_VERTEX_WITH_PROPERTY":
        doTransactionGetVertexWithProperty(db);
        break;
      case "GET_EDGE_WITH_PROPERTY":
        doTransactionGetEdgeWithProperty(db);
        break;
      case "GET_EDGES_WITH_LABEL":
        doTransactionGetEdgesWithLabel(db);
        break;
      case "SET_VERTEX_PROPERTY":
        doTransactionSetVertexProperty(db);
        break;
      case "SET_EDGE_PROPERTY":
        doTransactionSetEdgeProperty(db);
        break;
      case "REMOVE_VERTEX":
        doTransactionRemoveVertex(db);
        break;
      case "REMOVE_EDGE":
        doTransactionRemoveEdge(db);
        break;
        case "REMOVE_VERTEX_PROPERTY":
        doTransactionRemoveVertexProperty(db);
        break;
      case "REMOVE_EDGE_PROPERTY":
        doTransactionRemoveEdgeProperty(db);
        break;
      default:
        doTransactionGetVertexCount(db);
    }


    return true;
  }

  public void doTransactionAddVertex(DB db) {
    try {
      Map<String, String> obj = vertexStreamer.nextObject();
      if (obj == null) return; // no more vertices
      String id = obj.remove("_id");
      String label = obj.remove("xlabel");
      if (id == null || label == null) {
        System.out.println("Update vertex without _id or xlabel, skipped");
        return;
      }
      Status status = db.addVertex(label, id, obj);
      if (status != null && status.isOk()) {
        synchronized (insertedVertices) {
          insertedVertices.add(id);
        }
      }
      
    } catch (IOException e){
      System.out.println("Error fetching next vertex from the update workload");
    }
  }

  public void doTransactionAddEdge(DB db) {
    try {
      Map<String, String> obj = edgeStreamer.nextObject();
      if (obj == null) return; // no more edges

      String id = obj.remove("_id");
      String label = obj.remove("_label");
      String from = obj.remove("_outV");
      String to = obj.remove("_inV");
      if (id == null || label == null || from == null || to == null) {
        System.out.println("Update edge without _id, _label, _outV or _inV, skipped");
        return;
      }
      Status status = db.addEdge(label, id, from, to, obj);
      if (status != null && status.isOk()) {
        synchronized (insertedEdges) {
          insertedEdges.add(id);
        }
      }
    }catch(IOException e){
      System.out.println("Error fetching next edge from the update workload");
    }
  }

  public void doTransactionGetVertexCount(DB db) {
    db.getVertexCount();
  }
  public void doTransactionGetEdgeCount(DB db) {
    db.getEdgeCount();
  }
  public void doTransactionGetEdgeLabels(DB db) {
    db.getEdgeLabels();
  }
  public void doTransactionGetVertexWithProperty(DB db) {
    db.getVertexWithProperty("searchKey", propertyPool.next());
  }
  public void doTransactionGetEdgeWithProperty(DB db) {
    db.getEdgeWithProperty("searchKey", propertyPool.next());
  }
  public void doTransactionGetEdgesWithLabel(DB db) {
    db.getEdgesWithLabel(edgeLabels.get(ThreadLocalRandom.current().nextInt(edgeLabels.size())));
  }

  public void doTransactionSetVertexProperty(DB db) {
    String id = randomId(loadedVertexIds);
    if (id == null) {
      return;
    }
    db.setVertexProperty(id, "searchKey", propertyPool.next());

  }
  public void doTransactionSetEdgeProperty(DB db) {
    String id = randomId(loadedEdgeIds);
    if (id == null) {
      return;
    }
    db.setEdgeProperty(id, "searchKey", propertyPool.next());

  }
  public void doTransactionRemoveVertex(DB db) {
    String id;
    synchronized (insertedVertices) {
      id = insertedVertices.pollFirst();
    }
    if (id == null) {
      return;
    }
    db.removeVertex(id);
  }
  public void doTransactionRemoveEdge(DB db) {
    String id;
    synchronized (insertedEdges) {
      id = insertedEdges.pollFirst();
    }
    if (id == null) {
      return;
    }
    db.removeEdge(id);
  }

  public void doTransactionRemoveVertexProperty(DB db) {
    String id = randomId(loadedVertexIds);
    if (id == null) {
      return;
    }
    db.removeVertexProperty(id, "searchKey");

  }
  public void doTransactionRemoveEdgeProperty(DB db) {
    String id = randomId(loadedEdgeIds);
    if (id == null) {
      return;
    }
    db.removeEdgeProperty(id, "searchKey");

  }

//
//  /**
//   * Results are reported in the first three buckets of the histogram under
//   * the label "VERIFY".
//   * Bucket 0 means the expected data was returned.
//   * Bucket 1 means incorrect data was returned.
//   * Bucket 2 means null data was returned when some data was expected.
//   */
//  protected void verifyRow(String key, HashMap<String, ByteIterator> cells) {
//    Status verifyStatus = Status.OK;
//    long startTime = System.nanoTime();
//    if (!cells.isEmpty()) {
//      for (Map.Entry<String, ByteIterator> entry : cells.entrySet()) {
//        if (!entry.getValue().toString().equals(buildDeterministicValue(key, entry.getKey()))) {
//          verifyStatus = Status.UNEXPECTED_STATE;
//          break;
//        }
//      }
//    } else {
//      // This assumes that null data is never valid
//      verifyStatus = Status.ERROR;
//    }
//    long endTime = System.nanoTime();
//    measurements.measure("VERIFY", (int) (endTime - startTime) / 1000);
//    measurements.reportStatus("VERIFY", verifyStatus);
//  }
//

//
//  public void doTransactionRead(DB db) {
//    // choose a random key
//    long keynum = nextKeynum();
//
//    String keyname = CoreWorkload.buildKeyName(keynum, zeropadding, orderedinserts);
//
//    HashSet<String> fields = null;
//
//    if (!readallfields) {
//      // read a random field
//      String fieldname = fieldnames.get(fieldchooser.nextValue().intValue());
//
//      fields = new HashSet<String>();
//      fields.add(fieldname);
//    } else if (dataintegrity || readallfieldsbyname) {
//      // pass the full field list if dataintegrity is on for verification
//      fields = new HashSet<String>(fieldnames);
//    }
//
//    HashMap<String, ByteIterator> cells = new HashMap<String, ByteIterator>();
//    db.read(table, keyname, fields, cells);
//
//    if (dataintegrity) {
//      verifyRow(keyname, cells);
//    }
//  }
//
//  public void doTransactionReadModifyWrite(DB db) {
//    // choose a random key
//    long keynum = nextKeynum();
//
//    String keyname = CoreWorkload.buildKeyName(keynum, zeropadding, orderedinserts);
//
//    HashSet<String> fields = null;
//
//    if (!readallfields) {
//      // read a random field
//      String fieldname = fieldnames.get(fieldchooser.nextValue().intValue());
//
//      fields = new HashSet<String>();
//      fields.add(fieldname);
//    }
//
//    HashMap<String, ByteIterator> values;
//
//    if (writeallfields) {
//      // new data for all the fields
//      values = buildValues(keyname);
//    } else {
//      // update a random field
//      values = buildSingleValue(keyname);
//    }
//
//    // do the transaction
//
//    HashMap<String, ByteIterator> cells = new HashMap<String, ByteIterator>();
//
//
//    long ist = measurements.getIntendedStartTimeNs();
//    long st = System.nanoTime();
//    db.read(table, keyname, fields, cells);
//
//    db.update(table, keyname, values);
//
//    long en = System.nanoTime();
//
//    if (dataintegrity) {
//      verifyRow(keyname, cells);
//    }
//
//    measurements.measure("READ-MODIFY-WRITE", (int) ((en - st) / 1000));
//    measurements.measureIntended("READ-MODIFY-WRITE", (int) ((en - ist) / 1000));
//  }
//
//  public void doTransactionScan(DB db) {
//    // choose a random key
//    long keynum = nextKeynum();
//
//    String startkeyname = CoreWorkload.buildKeyName(keynum, zeropadding, orderedinserts);
//
//    // choose a random scan length
//    int len = scanlength.nextValue().intValue();
//
//    HashSet<String> fields = null;
//
//    if (!readallfields) {
//      // read a random field
//      String fieldname = fieldnames.get(fieldchooser.nextValue().intValue());
//
//      fields = new HashSet<String>();
//      fields.add(fieldname);
//    }
//
//    db.scan(table, startkeyname, len, fields, new Vector<HashMap<String, ByteIterator>>());
//  }
//
//  public void doTransactionUpdate(DB db) {
//    // choose a random key
//    long keynum = nextKeynum();
//
//    String keyname = CoreWorkload.buildKeyName(keynum, zeropadding, orderedinserts);
//
//    HashMap<String, ByteIterator> values;
//
//    if (writeallfields) {
//      // new data for all the fields
//      values = buildValues(keyname);
//    } else {
//      // update a random field
//      values = buildSingleValue(keyname);
//    }
//
//    db.update(table, keyname, values);
//  }
//
//  public void doTransactionInsert(DB db) {
//    // choose the next key
//    long keynum = transactioninsertkeysequence.nextValue();
//
//    try {
//      String dbkey = CoreWorkload.buildKeyName(keynum, zeropadding, orderedinserts);
//
//      HashMap<String, ByteIterator> values = buildValues(dbkey);
//      db.insert(table, dbkey, values);
//    } finally {
//      transactioninsertkeysequence.acknowledge(keynum);
//    }
//  }

  /**
   * Creates a weighted discrete values with database operations for a workload to perform.
   * Weights/proportions are read from the properties list and defaults are used
   * when values are not configured.
   * Current operations are "READ", "UPDATE", "INSERT", "SCAN" and "READMODIFYWRITE".
   *
   * @param p The properties list to pull weights from.
   * @return A generator that can be used to determine the next operation to perform.
   * @throws IllegalArgumentException if the properties object was null.
   */
  protected static DiscreteGenerator createOperationGenerator(final Properties p) {
    if (p == null) {
      throw new IllegalArgumentException("Properties object cannot be null");
    }
    final double createproportion = Double.parseDouble(
        p.getProperty(CREATE_PROPORTION_PROPERTY, CREATE_PROPORTION_PROPERTY_DEFAULT));
    final double readproportion = Double.parseDouble(
        p.getProperty(READ_PROPORTION_PROPERTY, READ_PROPORTION_PROPERTY_DEFAULT));
    final double updateproportion = Double.parseDouble(
        p.getProperty(UPDATE_PROPORTION_PROPERTY, UPDATE_PROPORTION_PROPERTY_DEFAULT));
    final double deleteproportion = Double.parseDouble(
        p.getProperty(DELETE_PROPORTION_PROPERTY, DELETE_PROPORTION_PROPERTY_DEFAULT));


    final DiscreteGenerator operationchooser = new DiscreteGenerator();
    if (readproportion > 0) {
      operationchooser.addValue(readproportion, "GET_VERTEX_COUNT");
      operationchooser.addValue(readproportion, "GET_EDGE_COUNT");
      operationchooser.addValue(readproportion, "GET_EDGE_LABELS");
      operationchooser.addValue(readproportion, "GET_VERTEX_WITH_PROPERTY");
      operationchooser.addValue(readproportion, "GET_EDGE_WITH_PROPERTY");
      operationchooser.addValue(readproportion, "GET_EDGES_WITH_LABEL");
    }

    if (updateproportion > 0) {
      operationchooser.addValue(updateproportion, "SET_VERTEX_PROPERTY");
      operationchooser.addValue(updateproportion, "SET_EDGE_PROPERTY");
    }

    if (createproportion > 0) {
      operationchooser.addValue(createproportion, "ADD_VERTEX");
      operationchooser.addValue(createproportion, "ADD_EDGE");
    }

    if (deleteproportion > 0) {
      operationchooser.addValue(deleteproportion, "REMOVE_VERTEX");
      operationchooser.addValue(deleteproportion, "REMOVE_EDGE");
      operationchooser.addValue(deleteproportion, "REMOVE_VERTEX_PROPERTY");
      operationchooser.addValue(deleteproportion, "REMOVE_EDGE_PROPERTY");
    }
    return operationchooser;
  }
}