cd ReplicatedGDB/
python3 Deployment.py down
cd ..
cd YCSB 
mvn -pl grace -am -DskipTests package
cd ..