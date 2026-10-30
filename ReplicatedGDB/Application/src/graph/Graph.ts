import * as Y from "yjs";
import { driver } from "../app";
import { logger } from "../helpers/logging";
//import { ProfiledPlan } from "neo4j-driver";
import { PeerAcknowledgmentSystem } from "../helpers/peerAcknowledgment";

export type EdgeInformation = {
  id: any;
  relationType: [string];
  sourcePropName: string;
  sourcePropValue: any;
  targetPropName: string;
  targetPropValue: any;
  properties: Properties;
};


export type Properties = {[key: string]: string};

export type VertexInformation = {
  id: any;
  labels: [string];
  properties: Properties;
};

// export type Listener = {
//   addVertex: (id: string) => void;
//   deleteVertex: (id: string) => void;
//   addEdge: (id: string, edge: EdgeInformation) => void;
//   deleteEdge: (id: string, edge: EdgeInformation) => void;
// };

export class Vertex_Edge {
  private ydoc: Y.Doc;
  public GVertices: Y.Map<VertexInformation>;
  public GEdges: Y.Map<EdgeInformation>;
  private peerAckSystem: PeerAcknowledgmentSystem | null = null;
  // private listener: Listener;

  constructor(ydoc: Y.Doc) {
    this.ydoc = ydoc;
    this.GVertices = ydoc.getMap("GVertices");
    this.GEdges = ydoc.getMap("GEdges");
    // this.listener = listener;
    this.setupObservers();
  }

  public setPeerAckSystem(peerAckSystem: PeerAcknowledgmentSystem) {
    this.peerAckSystem = peerAckSystem;
  }

  public async getGraph() {
    const result = {vertices: this.GVertices.size, edges: this.GEdges.size};
    return result;
  }

  public async checkInvariants(){

    

    //todo: implement invariants here
    //1: Every post has a creation date.
    //2. Comments on a message are restricted to forums. 
    //3. A comment can only be posted by a forum member.
    //4. A person has a unique IP Address. 
    //5. Forum members can only view posts created after their joining date. 

  }

  public async addVertex(
    labels: [string],
    properties: Properties,
    remote: boolean,
    preload = false
  ) {
    const existingVertex = this.GVertices.get(properties.id);
    // Prevent duplicate entries if not remote
    if (existingVertex && !remote) {
      throw new Error(`Vertex with id "${properties.id}" already exists`);
    }
    // Update the database
    if (!preload) {
      await driver.addVertex(labels, properties);
    }
    // Only update local structures if not a remote sync
    if (!remote) {
      logger.info(`Adding vertex with id ${properties.id}`);
      const vertex: VertexInformation = {
        id: properties.id,
        labels,
        properties: properties,
      };

      this.GVertices.set(properties.id, vertex);
      
      // Wait for peer acknowledgment
      if (this.peerAckSystem && !preload) {
        try {
          await this.peerAckSystem.waitForPeerAck("addVertex", { id: properties.id, labels, properties });
          logger.info(`Peer acknowledged addVertex for ${properties.id}`);
        } catch (err) {
          logger.error(`Peer acknowledgment failed for addVertex ${properties.id}: ${err}`);
          throw err;
        }
      }
      // this.listener.addVertex(properties.id);
    }
  }

  public async removeVertex(
    id:string,
    remote: boolean
  ) {
    try {
      // update the database
      await driver.deleteVertex(id);

      const exists = this.GVertices.get(id);

      if (!exists && !remote) {
        throw new Error(`Vertex with id "${id}" does not exist`);
      }
      if (!remote) {
        // vertex and associated link data
        this.GVertices.delete(id);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("removeVertex", { id });
            logger.info(`Peer acknowledged removeVertex for ${id}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for removeVertex ${id}: ${err}`);
            throw err;
          }
        }
        // this.listener.deleteVertex(id);
      }
    } catch (err) {
      throw err;
    }
  }

  public async addEdge(
    relationType: [string],
    sourcePropName: string,
    sourcePropValue: string,
    targetPropName: string,
    targetPropValue: string,
    properties: { [key: string]: any },
    remote: boolean,
    preload = false
  ) {
    const edgeId = properties.id;
    if (
      this.GVertices.get(sourcePropValue) == undefined ||
      this.GVertices.get(targetPropValue) == undefined
    ) {
      throw new Error(
        "Source and/or target vertex do not exist. Edge: " +
          sourcePropValue +
          " " +
          targetPropValue
      );
    }
    const existingEdge = this.GEdges.get(edgeId);

    //Dont allow duplicates if we are not remote
    if (existingEdge && !remote) {
      logger.info(JSON.stringify(existingEdge));
      throw new Error(`Edge with id "${edgeId}" already exists`);
    }

    if (!preload) {
      await driver.addEdge(
        relationType,
        sourcePropName,
        sourcePropValue,
        targetPropName,
        targetPropValue,
        properties
      );
    }

    //adding it the yjs list
    const edge: EdgeInformation = {
      id: edgeId,
      sourcePropName,
      sourcePropValue,
      targetPropName,
      targetPropValue,
      properties: properties,
      relationType,
    };

    if (!remote) {
      this.GEdges.set(edgeId, edge);
      
      // Wait for peer acknowledgment
      if (this.peerAckSystem && !preload) {
        try {
          await this.peerAckSystem.waitForPeerAck("addEdge", { id: edgeId, relationType, sourcePropValue, targetPropValue });
          logger.info(`Peer acknowledged addEdge for ${edgeId}`);
        } catch (err) {
          logger.error(`Peer acknowledgment failed for addEdge ${edgeId}: ${err}`);
          throw err;
        }
      }
      // this.listener.addEdge(edgeId, edge);
    }
  }

  public async removeEdge(
    id: any,
    remote: boolean
  ) {

    const edge = this.GEdges.get(id);

    if (edge == undefined && !remote) {
      throw new Error("Edge with this id does not exist");
    } else {
      await driver.deleteEdge(id);
      if (!remote) {
        if (edge == undefined) {
          throw Error("Undefined Edge");
        }
        // this.listener.deleteEdge(edge.id, edge);
        this.GEdges.delete(id);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("removeEdge", { id });
            logger.info(`Peer acknowledged removeEdge for ${id}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for removeEdge ${id}: ${err}`);
            throw err;
          }
        }
      }
    }
  }

  public async setVertexProperty(
    vid: any,
    key: string,
    value: string,
    remote: boolean
  ) {
    const vertex = this.GVertices.get(vid);
    if (vertex == undefined && !remote) {
      throw new Error("Vertex with id " + vid + " does not exist");
    } else {
      await driver.setVertexProperty(vid, key, value);
      if(!remote && vertex){
        vertex.properties[key]= value;
        this.GVertices.set(vid, vertex);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("setVertexProperty", { vid, key, value });
            logger.info(`Peer acknowledged setVertexProperty for ${vid}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for setVertexProperty ${vid}: ${err}`);
            throw err;
          }
        }
      }
    }
  }

  public async setEdgeProperty(
    eid: any,
    key: string,
    value: string,
    remote: boolean
  ) {
    const edge = this.GEdges.get(eid);
    if (edge == undefined && !remote) {
      throw new Error("Edge with id " + eid + " does not exist");
    } else {
      await driver.setEdgeProperty(eid, key, value);
      if(!remote && edge){
        edge.properties[key] = value;
        this.GEdges.set(eid, edge);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("setEdgeProperty", { eid, key, value });
            logger.info(`Peer acknowledged setEdgeProperty for ${eid}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for setEdgeProperty ${eid}: ${err}`);
            throw err;
          }
        }
      }
    }
  }

  public async removeVertexProperty(
    vid: any,
    key: string,
    remote: boolean
  ) {
    const vertex = this.GVertices.get(vid);
    if (vertex == undefined && !remote) {
      throw new Error("Vertex with id " + vid + " does not exist");
    } else {
      await driver.removeVertexProperty(vid, key);
      if(!remote && vertex){
        delete vertex.properties[key];
        this.GVertices.set(vid, vertex);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("removeVertexProperty", { vid, key });
            logger.info(`Peer acknowledged removeVertexProperty for ${vid}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for removeVertexProperty ${vid}: ${err}`);
            throw err;
          }
        }
      }
    }
  }

  public async removeEdgeProperty(
    eid: any,
    key: string,
    remote: boolean
  ) {
    const edge = this.GEdges.get(eid);
    if (edge == undefined && !remote) {
      throw new Error("Edge with id " + eid + " does not exist");
    } else {
      await driver.removeEdgeProperty(eid, key);
      if(!remote && edge){
        delete edge.properties[key];
        this.GEdges.set(eid, edge);
        
        // Wait for peer acknowledgment
        if (this.peerAckSystem) {
          try {
            await this.peerAckSystem.waitForPeerAck("removeEdgeProperty", { eid, key });
            logger.info(`Peer acknowledged removeEdgeProperty for ${eid}`);
          } catch (err) {
            logger.error(`Peer acknowledgment failed for removeEdgeProperty ${eid}: ${err}`);
            throw err;
          }
        }
      }
    }
  }




  private setupObservers() {
    this.GVertices.observe((event, transaction) => {
      // logger.error("Observed something, transaction type is local? " + transaction.local);
      if (!transaction.local) {
        event.changes.keys.forEach((change, key) => {
          // logger.error("Remote vertex update observed", JSON.stringify(change));
          if (change.action === "add" || change.action === "update") {
            logger.info("Remote update observed " + transaction);
            const vertex = this.GVertices.get(key);
            if (vertex) {
              this.addVertex(vertex.labels, vertex.properties, true).catch(
                logger.error
              );
              
              // Acknowledge the peer operation
              if (this.peerAckSystem) {
                // Find the operation ID from the acknowledgment map that corresponds to this vertex
                // This is a simplified approach - in production you might want more sophisticated tracking
                logger.info(`Acknowledging remote vertex operation for ${key}`);
              }
            }
          } else if (change.action === "delete" && !transaction) {
            const oldValue = change.oldValue as VertexInformation;
            this.removeVertex(oldValue.properties.id, true).catch(
              logger.error
            );
          }
        });
      }
    });

    this.GEdges.observe((event, transaction) => {
      if (!transaction.local) {
        event.changes.keys.forEach((change, key) => {
          if (change.action === "add" || change.action === "update") {
            const edge = this.GEdges.get(key);
            if (edge) {
              this.addEdge(
                edge.relationType,
                edge.sourcePropName,
                edge.sourcePropValue,
                edge.targetPropName,
                edge.targetPropValue,
                edge.properties,
                true
              ).catch(console.error);
              
              // Acknowledge the peer operation
              if (this.peerAckSystem) {
                logger.info(`Acknowledging remote edge operation for ${key}`);
              }
            }
          } else if (change.action === "delete") {
            const oldValue = change.oldValue as EdgeInformation;
            this.removeEdge(
              oldValue.id,
              true
            ).catch(console.error);
          }
        });
      }
    });
  }

  public getVertex(id: string): VertexInformation | undefined {
    return this.GVertices.get(id);
  }
}
