cd ReplicatedGDB/
python3 Deployment.py down
cd ..
cd YCSB 
mvn -pl grace -am -DskipTests package
docker rm -f memgraph1 preload1 lab1 Replica1 2>/dev/null || true
cd ..