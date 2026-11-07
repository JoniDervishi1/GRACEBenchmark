import express from "express";
import cookieParser from "cookie-parser";
import createError from "http-errors";
import http from "http";
import path from "path";

export var app = express();
let preloadDone = false;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  res.set("Connection", "close");
  next();
});

import { logger } from "./helpers/logging";

// Setup for prometheus
import client from "prom-client";
const register = new client.Registry();
client.collectDefaultMetrics({ register });
const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
});
register.registerMetric(httpRequests);

// Setup YJS

import Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocketPolyfill from "ws";

let ydoc = new Y.Doc();
ydoc.gc = true;

const wsProvider = new WebsocketProvider(
  process.env.WS_URI,
  "GraceSyncKey",
  ydoc,
  WebSocketPolyfill
);

// Peer-to-peer replication setup
export const REPLICA_ID = process.env.REPLICA_ID || "replica-0";
export const PEER_REPLICA_ID = process.env.PEER_REPLICA_ID || "replica-1";
export const PEER_DC_ID = process.env.PEER_DC_ID || "dc-1";
export const DATACENTER_ID = process.env.DATACENTER_ID || "dc-0";
export type AckLevel = "none" | "peer" | "dc" | "both";
export const ACK_LEVEL: AckLevel = (process.env.ACK_LEVEL as AckLevel) || "both";

logger.info(`Replica ${REPLICA_ID} in ${DATACENTER_ID}, peer: ${PEER_REPLICA_ID}, ack_level: ${ACK_LEVEL}`);

// Setup Database
import { GremlinDriver } from "./drivers/germlinDriver";
import { MemGraphDriver } from "./drivers/memgraphDriver";
import {ArangoDBDriver } from "./drivers/ArangoDBDriver";
import { MongoDBDriver } from "./drivers/MongoDBDriver";

// logger.info(`environment: ${JSON.stringify(process.env)}`);
const dbname = process.env.DATABASE;
logger.info(`Database specified ${dbname}`);
export var driver;
switch (dbname) {
  case "NEO4J":
  case "MEMGRAPH":
    driver = new MemGraphDriver();
    break;
  case "JANUSGRAPH":
    driver = new GremlinDriver();
    break;
  case "ARANGODB":
    driver = new ArangoDBDriver();
    break;
  case "MONGODB":
    driver = new MongoDBDriver();
    break;
    
  default:
    logger.error(
      "No database specified in configuration. Cannot initialize driver."
    );
    process.exit(1);
    break;
}

// Setup graph
import { Graph } from "./graph/GraphManager";
import { EdgeInformation, Vertex_Edge, VertexInformation } from "./graph/Graph";
import { PeerAcknowledgmentSystem } from "./helpers/peerAcknowledgment";

const GraphManager = new Graph();
export const graph = new Vertex_Edge(ydoc);
export const peerAckSystem = new PeerAcknowledgmentSystem(ydoc);

// Connect peer acknowledgment system to graph
graph.setPeerAckSystem(peerAckSystem);

import {
  VertexSchema,
  deleteVertexSchema,
  EdgeSchema,
  deleteEdgeSchema,
  setVertexPropertySchema,
  setEdgePropertySchema,
  removeVertexPropertySchema,
  removeEdgePropertySchema
} from "./schemas/requests";

//Setup application routes
import { query, checkSchema, validationResult, check } from "express-validator";
import {
  getGraph,
  addVertex,
  deleteVertex,
  addEdge,
  deleteEdge,
  setVertexProperty,
  setEdgeProperty,
  removeVertexProperty,
  removeEdgeProperty
} from "./routes/routes";
import { final } from "stream-chain";

{
  app.post("/reset", async (req, res) => {
    graph.GVertices.clear();
    graph.GEdges.clear();
    res.status(200).json({ status: "Graph reset successful" });
  });

  app.get("/getVertex", async (req, res) => {
    const id = req.query.id as string;
    const vertex = graph.getVertex(id);
    if (vertex) {
      res.status(200).json(vertex);
    } else {
      res.status(404).json({ error: "Vertex not found" });
    }
  });
  
  app.get('/ready', (req, res) => {
      if (preloadDone) res.sendStatus(200);
      else res.sendStatus(503); // 503 = Service Unavailable
  });

  app.get("/api/getGraph", async (req, res) => {
    await getGraph(req, res);
  });

  app.post(
    "/api/addVertex",
    checkSchema(VertexSchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Add Vertex Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await addVertex(req, res);
      }
    }
  );

  app.post(
    "/api/deleteVertex",
    checkSchema(deleteVertexSchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Delete Vertex Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await deleteVertex(req, res);
      }
    }
  );

  app.post(
    "/api/addEdge",
    checkSchema(EdgeSchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Add Edge Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await addEdge(req, res);
      }
    }
  );

  app.post(
    "/api/deleteEdge",
    checkSchema(deleteEdgeSchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Delete Edge Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await deleteEdge(req, res);
      }
    }
  );

  app.post("/api/setVertexProperty",
    checkSchema(setVertexPropertySchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Set Vertex Property Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await setVertexProperty(req, res);
      }
    }
  );

  app.post("/api/setEdgeProperty",
    checkSchema(setEdgePropertySchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Set Edge Property Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await setEdgeProperty(req, res);
      }
    }
  );

  app.post("/api/removeVertexProperty",
    checkSchema(removeVertexPropertySchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Remove Vertex Property Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await removeVertexProperty(req, res);
      }
    }
  );

  app.post("/api/removeEdgeProperty",
    checkSchema(removeEdgePropertySchema, ["body"]),
    async (req, res) => {
      const validation = validationResult(req);
      if (!validation.isEmpty()) {
        logger.error(
          `Remove Edge Property Malformed request rejected: ${JSON.stringify(
            validation.array()
          )}`
        );
        res.status(500).json("Malformed request.");
      } else {
        await removeEdgeProperty(req, res);
      }
    }
  );

  // catch 404 and forward to error handler
  app.use(function (req, res, next) {
    next(createError(404));
  });
}

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.send("error");
});

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

var port = normalizePort(process.env.PORT || "3000");
app.set("port", port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port);
server.on("error", onError);
server.on("listening", onListening);

function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }

  var bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case "EACCES":
      console.error(bind + " requires elevated privileges");
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(bind + " is already in use");
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

const fs = require("fs");
const { chain } = require("stream-chain");
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/Pick");
const { streamArray } = require("stream-json/streamers/StreamArray");
const { once } = require("events");

async function onListening() {
    logger.error(process.env.IS_PRELOAD_LEADER)

  if(process.env.IS_PRELOAD_LEADER == "Yes"){
    logger.error("I am preloading leader. Handling the initialisation of PG-CRDT");
  // If the middleware crashes and restarts, it needs to reinitialise the database.
    try {
      let vertexFut: Promise<any>[] = [];
      let edgeFut = [];
      // Load vertices from the file into YJS document

      const vertexPipeline = chain([
        fs.createReadStream("/var/lib/grace/import/vertices.json"),
        parser(),
        streamArray(),
      ]);

      vertexPipeline.on("data", async ({ value }) => {
        value.id = value._id.toString();
        // logger.info(JSON.stringify(value));

        // The label is the dataset's xlabel. It is the vertex label, not a property, so it is
        // left out of the properties (same as the Memgraph preload).
        const { xlabel, ...vertexProperties } = value;
        if (!xlabel) {
          logger.error("Preload: vertex " + value.id + " has no xlabel, skipped");
          return;
        }
        const vertex: VertexInformation = {
                id: value.id.toString(),
                labels: [String(xlabel)],
                properties: vertexProperties,
              };
        graph.GVertices.set(value.id,vertex);
      });

      // Wait for final batch at the end of the stream
      await vertexPipeline.on("end", async () => {
        logger.info("✅ All vertices inserted");

        
        const edgePipeline = chain([
          fs.createReadStream("/var/lib/grace/import/edges.json"),
          parser(),
          streamArray(),
        ]);

        edgePipeline.on("data", async ({ value }) => {
          value.id = value._id.toString();
          // The edge type is the dataset's _label, not a property.
          const { _label, ...edgeProperties } = value;
          if (!_label) {
            logger.error("Preload: edge " + value.id + " has no _label, skipped");
            return;
          }
          //adding it the yjs list
              const edge: EdgeInformation = {
                id: value.id.toString(),
                sourcePropName: "id",
                sourcePropValue: value._outV.toString(),
                targetPropName: "id",
                targetPropValue: value._inV.toString(),
                properties: edgeProperties,
                relationType: [String(_label)],
              };
            
              graph.GEdges.set(value.id, edge);
          
        });
        await once(edgePipeline, "end");
        preloadDone = true;
        let size = Y.encodeStateAsUpdateV2(ydoc).length;
        // logger.error(JSON.stringify(Y.encodeStateAsUpdate(ydoc)))
        logger.error(
          `✅ All edges inserted. Preload complete. Yjs document size is ${size} bytes`
        );      
      });




    } catch (e) {
      logger.error("Exception when loading data from a file " + e);
    }
  }
  else{
    logger.error("I am not the crdt preload leader. Waiting for remote updates")
  }
  var addr = server.address();
  var bind = typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
  logger.debug("Listening on " + bind);
}