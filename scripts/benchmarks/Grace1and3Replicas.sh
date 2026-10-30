# Benchmark with GRACE
echo "Benchmarking GRACE with multiple replica configurations"

# Define replica configurations to test

for num_replicas in "${REPLICAS[@]}"; do
    echo "Benchmarking GRACE with $num_replicas Replica(s)"
    
    # Deploy the replicas
    cd $GRACE_DIRECTORY

    # Create a distribution configuration
    cat > $DIST_CONF <<EOL
{
  "base_website_port": 7474,
  "base_protocol_port": 7687,
  "base_app_port": 3000,
  "base_prometheus_port": 9090,
  "base_grafana_port": 5000,
  "provider_port": 1234,
  "provider": true,
EOL

    # Handle preload_data logic based on number of replicas
    if [ $num_replicas -eq 1 ]; then
        cat >> $DIST_CONF <<EOL
  "preload_data": true,
  "preload_vertices": "$ROOT_DIRECTORY/GraphDBData/yeast_load_vertices.json",
  "preload_edges": "$ROOT_DIRECTORY/GraphDBData/yeast_load_edges.json",
  "dataset_name": "${DATASET_NAME}",
EOL
    elif [ $num_replicas -eq 2 ]; then
        cat >> $DIST_CONF <<EOL
  "preload_data": true,
  "preload_vertices": "$ROOT_DIRECTORY/GraphDBData/${DATASET_NAME}_load_vertices.json",
  "preload_edges": "$ROOT_DIRECTORY/GraphDBData/${DATASET_NAME}_load_edges.json",
  "dataset_name": "${DATASET_NAME}",
EOL
    else
        cat >> $DIST_CONF <<EOL
  "preload_data": false,
EOL
    fi

    # Add databases array (legacy format - 1 replica per DC)
    echo '  "dbs" : [' >> $DIST_CONF
    
    for ((i=1; i<=num_replicas; i++)); do
        # Set log level based on replica count
        if [ $num_replicas -eq 1 ]; then
            log_level="error"
        elif [ $num_replicas -eq 2 ]; then
            log_level="info"
        else
            log_level="error"
        fi
        
        # Add database entry
        cat >> $DIST_CONF <<EOL
    {
     "database": "memgraph", 
      "password": "verysecretpassword",
      "user": "pandey",
      "app_log_level": "$log_level"
    } 
EOL
        
        # Add comma if not last entry
        if [ $i -lt $num_replicas ]; then
            echo "," >> $DIST_CONF
        fi
    done
    
    echo '' >> $DIST_CONF
    echo '  ]' >> $DIST_CONF
    echo '}' >> $DIST_CONF

    # Start the replicas
    python3 Deployment.py up $DIST_CONF -v
    sleep 5

    cd $ROOT_DIRECTORY

    # Wait for server to be ready
    wait_interval=5

    
    until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ready | grep -q 200; do
        echo "Waiting for server preload to finish..."
        sleep $wait_interval
    done

    # Setup latencies for multi-replica configurations
    if [ $num_replicas -gt 1 ]; then
        latency_cmd="docker exec -it wsserver sh -c \"/usr/local/bin/setup-latency.sh wsserver"
        for ((i=2; i<=num_replicas; i++)); do
            latency_value=$(get_latency $((0)) $((i-1)))
            echo " wsserver(${region_codes[0]}) -> Replica${i-1} (${region_codes[$((i-1))]}): ${latency_value}ms"
            latency_cmd="$latency_cmd Grace$i ${latency_value}"
        done
        latency_cmd="$latency_cmd\""
        eval $latency_cmd
    fi

    STATUS_STRING=''
    if [ $INJECT_FAULTS=true ]; then
        STATUS_STRING='-s'
    fi
    # Run the benchmark with grace workload
    echo "Running YCSB benchmark with Grace workload for $num_replicas replicas"
    cd $YCSB_DIRECTORY
    # Build the ycsb command
    ycsb_cmd="bin/ycsb.sh run grace $STATUS_STRING -P workloads/workload_grace \
        -p HOSTURI=\"http://localhost:3000\" \
        -p DBTYPE=\"memgraph\" \
        -p DBURI=\"bolt://localhost:7687\" \
        -p maxexecutiontime=$DURATION \
        -p threadcount=$YCSB_THREADS \
        -p loadVertexFile=$DATA_DIRECTORY/${DATASET_NAME}_load_vertices.json \
        -p loadEdgeFile=$DATA_DIRECTORY/${DATASET_NAME}_load_edges.json \
        -p vertexAddFile=$DATA_DIRECTORY/${DATASET_NAME}_update_vertices.json \
        -p edgeAddFile=$DATA_DIRECTORY/${DATASET_NAME}_update_edges.json \
        &> $RESULTS_DIRECTORY/GRACE/$num_replicas.txt"
    
    eval $ycsb_cmd & YCSB_PID=$! 
    sleep $((DURATION/2))
    if [ "$INJECT_FAULTS" = true ]; then
        echo "Fault injection enabled. Simulating network partition."
        #simulate a network partition by adding a large latency between R1 and one of the replicas. 
        docker exec -it wsserver sh -c "/usr/local/bin/setup-latency.sh wsserver Grace2 100000"

        # Wait for some time to let the system stabilize
        sleep 60

        # Restore normal latency
        docker exec -it wsserver sh -c "/usr/local/bin/setup-latency.sh wsserver Grace2 50"
        echo "Network partition resolved."
    fi
    wait $YCSB_PID
    # Switch to GRACE directory for cleanup
    cd $GRACE_DIRECTORY
    
    # Tear down the deployment
    python3 Deployment.py down $DIST_CONF
    
    # Remove the distribution configuration file
    rm $DIST_CONF
    
    echo "Completed benchmarking with $num_replicas replica(s)"
    echo "----------------------------------------"
done

echo "All GRACE benchmarking completed!"


