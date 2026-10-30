#!/bin/bash

ROOT_DIRECTORY=$(pwd)
PRELOAD=false
DURATION=120 #Benchmark duration in seconds
echo "Benchmark duration: $DURATION seconds"
INJECT_FAULTS=false
echo "Root Directory: $ROOT_DIRECTORY"
DEPLOYMENTS_DIR="$ROOT_DIRECTORY/Deployments"
GRACE_DIRECTORY="$ROOT_DIRECTORY/ReplicatedGDB"
LF_DIRECTORY="$ROOT_DIRECTORY/LeaderFollower"
YCSB_DIRECTORY="$ROOT_DIRECTORY/YCSB"
PRELOAD_DATA="$ROOT_DIRECTORY/PreloadData"
export PRELOAD_DATA="$ROOT_DIRECTORY/PreloadData"


# JANUSGRAPH_DIRECTORY="$ROOT_DIRECTORY/JanusgraphServer"
# mkdir -p $JANUSGRAPH_DIRECTORY
# cd $JANUSGRAPH_DIRECTORY
# if [ ! -f "./janusgraph-full-1.1.0.zip" ]; then
#     wget -P . https://github.com/JanusGraph/janusgraph/releases/download/v1.1.0/janusgraph-full-1.1.0.zip
# fi




DIST_CONF=$ROOT_DIRECTORY"/distribution_config.json"
# latencies=(54 147 54 54 54 54 54 54 54)
# latencies=(0 1 2 3 4 5 6 7 0 0)
# Use associative array for reliable cross-shell compatibility
declare -A latency_matrix

# Helper function to get/set matrix element
get_latency() {
    local r=$1
    local c=$2
    local key="${r},${c}"
    echo "${latency_matrix[$key]}"
}

set_latency() {
    local r=$1
    local c=$2
    local value=$3
    local key="${r},${c}"
    latency_matrix[$key]=$value
}

# AWS Region latencies from cloudping.co (in milliseconds)
# Region mapping (index 0-5):
# 0: us-east-1 (N. Virginia)
# 1: us-west-2 (Oregon)
# 2: eu-central-1 (Frankfurt)
# 3: ap-south-1 (Mumbai)
# 4: ap-southeast-1 (Singapore)
# 5: sa-east-1 (São Paulo)

# Initialize the symmetric latency matrix with actual AWS latencies
# Row 0: us-east-1
set_latency 0 0 0
set_latency 0 1 33
set_latency 0 2 48
set_latency 0 3 104
set_latency 0 4 111
set_latency 0 5 57

# Row 1: us-west-2
set_latency 1 0 33
set_latency 1 1 0
set_latency 1 2 72
set_latency 1 3 112
set_latency 1 4 83
set_latency 1 5 89

# Row 2: eu-central-1
set_latency 2 0 48
set_latency 2 1 72
set_latency 2 2 0
set_latency 2 3 65
set_latency 2 4 81
set_latency 2 5 102

# Row 3: ap-south-1
set_latency 3 0 104
set_latency 3 1 112
set_latency 3 2 65
set_latency 3 3 0
set_latency 3 4 33
set_latency 3 5 152

# Row 4: ap-southeast-1
set_latency 4 0 111
set_latency 4 1 83
set_latency 4 2 81
set_latency 4 3 33
set_latency 4 4 0
set_latency 4 5 166

# Row 5: sa-east-1
set_latency 5 0 57
set_latency 5 1 89
set_latency 5 2 102
set_latency 5 3 152
set_latency 5 4 166
set_latency 5 5 0

# Region names and codes for display
region_names=("US East (Virginia)" "US West (Oregon)" "EU Central (Frankfurt)" "AP South (Mumbai)" "AP Southeast (Singapore)" "SA East (São Paulo)")
region_codes=("us-east-1" "us-west-2" "eu-central-1" "ap-south-1" "ap-southeast-1" "sa-east-1")


DATABASES=(GRACE MemGraph Neo4j ArangoDB MongoDB JanusGraph)


# yeast mico ldbc frbs frbm frbo frbl
datasets=(ldbc)
# Eventually this set of commands will be in a loop and potentially parallel?

DATA_DIRECTORY="$ROOT_DIRECTORY/GraphDBData"
# if the data directory does not exist, create it
if [ ! -d "$DATA_DIRECTORY" ]; then
    mkdir -p "$DATA_DIRECTORY"
fi


# REPLICAS=(1)
# INJECT_FAULTS=false
# YCSB_THREADS=1
# for dataset in "${datasets[@]}"; do
#     echo "Starting benchmarks for dataset: $dataset"
#     DATASET_NAME=$dataset
#     cd $ROOT_DIRECTORY
#     . ./scripts/data-preparation/PrepareDatasets.sh
#     RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/GraceReplicasInDC/$DATASET_NAME"
#     LOAD_TIME_DIRECTORY="$ROOT_DIRECTORY/LoadTimes/GraceReplicasInDC/$DATASET_NAME"
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded
    
    
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys
    
    
#     # Create results directory if it doesn't exist
#     mkdir -p $RESULTS_DIRECTORY
#     for db in "${DATABASES[@]}"; do
#         mkdir -p $RESULTS_DIRECTORY/$db
#     done
    
#     for db in "${DATABASES[@]}"; do
#         mkdir -p $LOAD_TIME_DIRECTORY/$db
#     done
    
#     cd $ROOT_DIRECTORY
#     . ./scripts/benchmarks/GraceReplicasinDC.sh
# done


## Replication and Latency Benchmarks
# REPLICAS=(1 3 2 4 5 6)
REPLICAS=(1)
INJECT_FAULTS=false
YCSB_THREADS=1
for dataset in "${datasets[@]}"; do
    
    echo "Starting benchmarks for dataset: $dataset"
    DATASET_NAME=$dataset
    cd $ROOT_DIRECTORY
    . ./scripts/data-preparation/PrepareDatasets.sh
    RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/ReplicaCountAndLatency/$DATASET_NAME"
    LOAD_TIME_DIRECTORY="$ROOT_DIRECTORY/LoadTimes/ReplicaCountAndLatency/$DATASET_NAME"
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded
    
    
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
    cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys
    
    
    # Create results directory if it doesn't exist
    mkdir -p $RESULTS_DIRECTORY
    for db in "${DATABASES[@]}"; do
        mkdir -p $RESULTS_DIRECTORY/$db
    done
    
    for db in "${DATABASES[@]}"; do
        mkdir -p $LOAD_TIME_DIRECTORY/$db
    done 
    
    # echo "Compiling YCSB..."
    # cd $YCSB_DIRECTORY
    # mvn clean package -DskipTests -q
    # echo "YCSB compilation complete."
   
    cd $ROOT_DIRECTORY
    . ./scripts/benchmarks/ReplicaCountAndLatency.sh
    
done

# cd $ROOT_DIRECTORY

# python3 ./scripts/analysis/LatencyComparision.py 1 ./Results/ReplicaCountAndLatency/ ./BenchmarkPlots/SingleReplicaLatency.png

# python3 ./scripts/analysis/LatencyComparision.py 3 ./Results/ReplicaCountAndLatency/ ./BenchmarkPlots/MultiReplicaLatency.png

# # # 3 replica throughput
# # REPLICAS=(3)

# #     DATASET_NAME=ldbc
# #     echo "Starting benchmarks for dataset: $DATASET_NAME"
# #     cd $ROOT_DIRECTORY
# #     . ./PrepareDatasets.sh

# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded


# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys



# # for i in {3..6}; do
# #     YCSB_THREADS=$((2**i))
# #     RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/ThroughputLatency/$YCSB_THREADS"
# #     # echo "Results Directory: $RESULTS_DIRECTORY"

# #     # Create results directory if it doesn't exist
# #     mkdir -p $RESULTS_DIRECTORY
# #     for db in "${DATABASES[@]}"; do
# #         mkdir -p $RESULTS_DIRECTORY/$db
# #     done


# #     echo "Running benchmarks with $YCSB_THREADS threads"
# #     cd $ROOT_DIRECTORY
# #     . ./ReplicaCountAndLatency.sh

# # done


# # DATASET_NAME=mico
# # DURATION=30
# # cd $ROOT_DIRECTORY
# # . ./PrepareDatasets.sh
# # RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/HeterogeneousDeployment/$DATASET_NAME"
# # LOAD_TIME_DIRECTORY="$ROOT_DIRECTORY/LoadTimes/HeterogeneousDeployment/$DATASET_NAME"
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
# # cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys

# # cd $ROOT_DIRECTORY
# # . ./GraceHeterogeneousReplicas.sh





# # ## Replication and Latency Benchmarks
# # REPLICAS=(1)
# # YCSB_THREADS=1
# # datasets=(ldbc)
# # for dataset in "${datasets[@]}"; do
    
# #     echo "Starting benchmarks for dataset: $dataset"
# #     DATASET_NAME=$dataset
# #     cd $ROOT_DIRECTORY
# #     . ./PrepareDatasets.sh
# #     RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/InvariantLatency/$DATASET_NAME"
# #     LOAD_TIME_DIRECTORY="$ROOT_DIRECTORY/LoadTimes/InvariantLatency/$DATASET_NAME"
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded
    
    
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
# #     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys
    
    
# #     # Create results directory if it doesn't exist
# #     mkdir -p $RESULTS_DIRECTORY
# #     for db in "${DATABASES[@]}"; do
# #         mkdir -p $RESULTS_DIRECTORY/$db
# #     done
    
# #     for db in "${DATABASES[@]}"; do
# #         mkdir -p $LOAD_TIME_DIRECTORY/$db
# #     done
    
# #     cd $YCSB_DIRECTORY
# #     mvn clean package -DskipTests -q
    
# #     cd $ROOT_DIRECTORY
# #     . ./Grace1and3Replicas.sh
    
# # done


# ## Failure benchmarks
# DURATION=300
# INJECT_FAULTS=true
# REPLICAS=(3)
# YCSB_THREADS=1
# datasets=(ldbc)
# for dataset in "${datasets[@]}"; do
    
#     echo "Starting benchmarks for dataset: $dataset"
#     DATASET_NAME=$dataset
#     cd $ROOT_DIRECTORY
#     . ./PrepareDatasets.sh
#     RESULTS_DIRECTORY="$ROOT_DIRECTORY/Results/DisconnectedOperation/$DATASET_NAME"
#     LOAD_TIME_DIRECTORY="$ROOT_DIRECTORY/LoadTimes/DisconnectedOperation/$DATASET_NAME"
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.loaded $YCSB_DIRECTORY/Vertices.loaded
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.loaded $YCSB_DIRECTORY/Edges.loaded
    
    
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.csv $PRELOAD_DATA/vertices.csv
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.csv $PRELOAD_DATA/edges.csv
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json $PRELOAD_DATA/vertices.json
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.json $PRELOAD_DATA/edges.json
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_vertices.keys $PRELOAD_DATA/vertices.keys
#     cp $DATA_DIRECTORY/${DATASET_NAME}_load_edges.keys $PRELOAD_DATA/edges.keys
    
    
#     # Create results directory if it doesn't exist
#     mkdir -p $RESULTS_DIRECTORY
#     for db in "${DATABASES[@]}"; do
#         mkdir -p $RESULTS_DIRECTORY/$db
#     done
    
#     for db in "${DATABASES[@]}"; do
#         mkdir -p $LOAD_TIME_DIRECTORY/$db
#     done
    
#     cd $YCSB_DIRECTORY
#     mvn clean package -DskipTests -q
    
#     cd $ROOT_DIRECTORY
#     . ./ReplicaCountAndLatency.sh
    
# done


# # echo "Adding network latency between replicas..."
# # echo "Using AWS inter-region latencies from cloudping.co"
# # echo ""
# # echo "Latency Matrix (milliseconds):"
# # echo "═══════════════════════════════════════════════════════════════════════════"

# # # Print the matrix header
# # printf "%-25s " ""
# # for (( col=0; col<i; col++ )); do
# #     printf "%-8s " "R$((col+1))"
# # done
# # echo
# # printf "%-25s " ""
# # for (( col=0; col<i; col++ )); do
# #     printf "%-8s " "(${region_codes[$col]#*-})"
# # done
# # echo
# # echo "───────────────────────────────────────────────────────────────────────────"

# # # Print the matrix with row labels
# # for (( row=0; row<i; row++ )); do
# #     printf "R%-2d %-20s " $((row+1)) "${region_names[$row]}"
# #     for (( col=0; col<i; col++ )); do
# #         if [ $row -eq $col ]; then
# #             printf "%-8s " "-"
# #         else
# #             printf "%-8d " "$(get_latency $row $col)"
# #         fi
# #     done
# #     echo
# # done
# # echo "═══════════════════════════════════════════════════════════════════════════"
# # echo ""

# # # Configure latencies for each container
# # for (( j=1; j<=i; j++ )); do
# #     # Build arguments for all peers of container j
# #     latency_args=""
# #     for (( k=1; k<=i; k++ )); do
# #         if [ $j -ne $k ]; then
# #             echo $j $k
# #             # Get latency from matrix (convert from 1-indexed to 0-indexed)
# #             latency_value=$(get_latency $((j-1)) $((k-1)))
# #             latency_args="$latency_args scylla${k} ${latency_value}"
# #             echo " scylla${j} (${region_codes[$((j-1))]}) -> scylla${k} (${region_codes[$((k-1))]}): ${latency_value}ms"
# #         fi
# #     done
    
# #     echo "Configuring all latencies for scylla${j}..."
# #     if ! docker exec scylla${j}-netem sh -c "/usr/local/bin/setup-latency.sh scylla${j} $latency_args"; then
# #         echo "❌ Failed to configure latencies for scylla${j}"
# #     else
# #         echo "✅ Configured latencies for scylla${j}"
# #     fi
# # done

# echo ""
# echo "✅ Network latency configuration completed"
# echo ""
# echo "Region Summary:"
# for (( idx=0; idx<i; idx++ )); do
#     echo "  R$((idx+1)): ${region_names[$idx]} (${region_codes[$idx]})"
# done



# cd $ROOT_DIRECTORY
# python3 scripts/benchmarks/DivergenceInjection.py
# # cd $ROOT_DIRECTORY/GRACE
# # python3 Deployment.py up

# # # Inject network latencies between replicas. 
# # latency_cmd="docker exec -it wsserver sh -c \"/usr/local/bin/setup-latency.sh wsserver"
# # for ((i=2; i<=3; i++)); do
# #     latency_value=$(get_latency $((0)) $((i-1)))
# #     echo " wsserver(${region_codes[0]}) -> Replica${i-1} (${region_codes[$((i-1))]}): 2500ms"
# #     latency_cmd="$latency_cmd Grace$i 2500"
# # done
# # latency_cmd="$latency_cmd\""
# # eval $latency_cmd



echo "Benchmarking completed. Results are stored in the Results directory."
