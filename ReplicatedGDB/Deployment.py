import sys
import string
import subprocess
import json
import yaml
import os
import re
from textwrap import dedent, indent
import time
import threading

VERBOSE = False
BENCHMARK = False
PATH ="DistributionConfig.json"


def spinner(stop_event):
    spinner_chars = ['|', '/', '-', '\\']
    idx = 0
    while not stop_event.is_set():
        print('\r' + spinner_chars[idx % len(spinner_chars)] + '...', end='', flush=True)
        idx += 1
        time.sleep(0.1)
    print('\r', end='')
    
def run_command(cmd):
    global VERBOSE
    if VERBOSE:
        process = subprocess.Popen(cmd, stdout=sys.stdout, stderr=sys.stderr)
        process.wait()
        rc = process.returncode
    else:
        stop_event = threading.Event()
        thread = threading.Thread(target=spinner, args=(stop_event,))
        thread.start()

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = process.communicate()

        stop_event.set()
        thread.join()
        rc = process.returncode

        # Optionally: print output on failure or log
        if rc != 0:
            print(stdout.decode())
            print(stderr.decode(), file=sys.stderr)
    
    if rc == 0:
      print("✅ Done.")  
    else:
      print(f"❌ Command failed with code {rc}")
    return rc
    

def load_config():
    with open(PATH, "r") as f:
        return json.load(f)
      
def network_create(external_network_instances):
  print("Creating shared network: Shared_net")
  run_command(["docker", "network", "create", "Shared_net"])
  for n in external_network_instances:
    print(f"Creating network: {n}...")
    try: 
      run_command(["docker", "network", "create", n])
    except Exception: pass

def generate_provider(config, external_network_instances):
    port = config["provider_port"]

    # Create external networks (your helper)
    network_create(external_network_instances)

    # Build YAML explicitly to avoid indentation issues
    lines = [
        "name: Provider",
        "services:",
        "  wsserver:",
        "    container_name: wsserver",
        "    build:",
        "      context: ../",
        "      dockerfile: ./Dockerfiles/WSServerDockerfile",
        "    ports:",
        f'      - "{port}:1234"',
        "    environment:",
        f'      PORT: "{port}"',
        '      HOST: "0.0.0.0"',
        "    cap_add:",
        "       - NET_ADMIN",
        "    networks:",
        "      - Shared_net"
    ]
    # attach to each external Grace network
    for n in external_network_instances:
        lines.append(f"      - {n}")

    # networks section
    lines += [
        "",
        "networks:",
        "  Shared_net:",
        "     external: true"
    ]
    for n in external_network_instances:
        lines += [
            f"  {n}:",
            "    external: true",
        ]

    content = "\n".join(lines) + "\n"

    filename = "docker-compose.provider.yml"
    filepath = f"./Dockerfiles/{filename}"
    with open(filepath, "w") as f:
        f.write(content)
    print(f"Generated {filepath}")
    return filepath
  
  
def generate_compose_file(dc_idx, replica_idx, dc_conf, config):
    """
    Generate a compose file for a specific replica in a datacenter.
    dc_idx: datacenter index (0-based)
    replica_idx: replica index within the datacenter (0-based)
    """
    replicas_per_dc = config.get("replicas_per_dc", 1)
    # Calculate global replica index
    i = dc_idx * replicas_per_dc + replica_idx
    
    website_port = config["base_website_port"] + i
    protocol_port = config["base_protocol_port"] + i
    app_port = config["base_app_port"] + i
    prometheus_port = config["base_prometheus_port"] + i
    grafana_port = config["base_grafana_port"] + i

    
    app_log_level = dc_conf["app_log_level"]
    ack_level = config.get("ack_level", "dc")
    database = dc_conf["database"]
    password = dc_conf["password"]
    db_user = dc_conf["user"]
    dc_name = dc_conf.get("name", f"DC{dc_idx + 1}")

    db_name = f"{database}{i+1}"
    preloadName = f"preload{i+1}"
    app_name = f"app{i+1}"
    grace_name = f"Grace{i+1}"
    prometheus_name = f"Prometheus{i+1}"
    grafana_name = f"Grafana{i+1}"
    network_name = f"Grace_net_{i+1}"

    # Determine replica IDs for peer-to-peer replication
    replica_id = f"{dc_name}-replica-{replica_idx}"
    # Peer is the other replica in the same datacenter
    # Only set a peer if there are 2 or more replicas per DC
    if replicas_per_dc >= 2:
        peer_replica_idx = 1 - replica_idx if replicas_per_dc == 2 else (replica_idx + 1) % replicas_per_dc
        peer_replica_id = f"{dc_name}-replica-{peer_replica_idx}"
    else:
        # No peer for single replica per DC
        peer_replica_id = "none"

    # Determine peer datacenter ID for cross-DC sync replication
    datacenters = config.get("datacenters", [])
    if len(datacenters) >= 2:
        peer_dc_idx = (dc_idx + 1) % len(datacenters)
        peer_dc_conf = datacenters[peer_dc_idx]
        peer_dc_id = peer_dc_conf.get("name", f"DC{peer_dc_idx + 1}")
    else:
        peer_dc_id = "none"

    preload_block = ""
    volume_block= ""
  
    if database == "neo4j":
        db_url = f"bolt://{db_name}:7687"
        databaseService = dedent(f"""
        {db_name}:
          image: neo4j:4.4.24
          container_name: {db_name}
          ports:
            - "{website_port}:7474"
            - "{protocol_port}:7687"
          environment:
            NEO4J_AUTH: none
            NEO4JLABS_PLUGINS: '["apoc"]'
            NEO4J_apoc_import_file_enabled: "true"
            NEO4J_apoc_import_file_use__neo4j__config: "true"
            NEO4J_dbms_security_procedures_unrestricted: "apoc.*"
          volumes:
            - {PRELOAD_DATA}:/var/lib/neo4j/import
          ulimits:
            nofile:
              soft: 40000
              hard: 40000
          
          healthcheck:
            test: [ "CMD", "bash", "-c", "cypher-shell -u neo4j -p {password} 'RETURN 1'" ]
            interval: 10s
            timeout: 5s
            retries: 10
          networks:
            - Shared_net
          {volume_block}
        {preloadName}:
          image: neo4j:4.4.24
          container_name: preload{i+1}
          depends_on:
            {db_name}:
              condition: service_healthy
          volumes:
            - {PRELOAD_DATA}:/var/lib/neo4j/import
          entrypoint:
            [
              "bash", "-c",
              "cypher-shell -a bolt://{db_name}:7687 -u pandey -p verysecretpassword -f /var/lib/neo4j/import/preloadNeo4j.cypher"
            ]
          networks:
            - Shared_net

        """).strip("\n")
    elif database == "memgraph":  # memgraph
        db_url = f"bolt://{db_name}:7687"
        databaseService = dedent(f"""
        {db_name}:
          image: memgraph/memgraph:latest
          container_name: {db_name}
          command: [
            "--log-level=TRACE", 
            "--storage-enable-schema-metadata=true"
            ]
          volumes:
            - {PRELOAD_DATA}:/var/lib/memgraph/import
          healthcheck:
            test: ["CMD-SHELL", "echo 'RETURN 0;' | mgconsole || exit 1"]
            interval: 10s
            timeout: 5s
            retries: 3
            start_period: 0s
          ports:
            - "{protocol_port}:7687"
          networks:
            - Shared_net
        {preloadName}:
          image: memgraph/memgraph:latest
          container_name: preload{i+1}
          depends_on:
            {db_name}:
              condition: service_healthy
          volumes:
            - {PRELOAD_DATA}:/var/lib/memgraph/import
          entrypoint:
            [
              "bash", "-c",
              "cat  /var/lib/memgraph/import/preloadMemgraph.cypher | mgconsole --host {db_name} --port 7687"
            ]
          networks:
            - Shared_net
        lab{i+1}:
          image: memgraph/lab
          container_name: lab{i+1}
          depends_on:
            {db_name}:
              condition: service_healthy
          ports:
            - "{website_port}:3000"
          environment:
            QUICK_CONNECT_MG_HOST: {db_name}
            QUICK_CONNECT_MG_PORT: 7687
          networks:
            - Shared_net

        """).strip("\n")
    elif database == "janusgraph":  # janusgraph
        db_url = f"ws://{db_name}:8182"
        databaseService = dedent(f"""
        {db_name}:
          image: docker.io/janusgraph/janusgraph:latest
          container_name: {db_name}
          healthcheck:
            test: ["CMD-SHELL", "bin/gremlin.sh", "-e", "scripts/remote-connect.groovy"]
            interval: 25s
            timeout: 20s
            retries: 3
          ports:
            - "{protocol_port}:8182"
          networks:
            - Shared_net
        """).strip("\n")

    elif database == "arangodb":  # arangodb
        db_url = f"http://{db_name}:8529"
        databaseService = dedent(f"""
        {db_name}:
          image: arangodb:latest
          container_name: {db_name}
          environment:
            ARANGO_NO_AUTH : 1
          healthcheck:
            test: ["CMD-SHELL", "arangosh --server.endpoint tcp://127.0.0.1:8529 --server.authentication false --javascript.execute-string 'quit(0)'"]
            interval: 5s
            timeout: 5s
            retries: 5
          ports:
            - "{protocol_port}:8529"
          volumes:
            - {PRELOAD_DATA}:/var/lib/arangodb/import
          networks:
            - Shared_net
        {preloadName}:
          image: arangodb:latest
          container_name: {preloadName}
          depends_on:
            {db_name}:
              condition: service_healthy
          volumes:
            - ../../PreloadData:/var/lib/arangodb/import
          entrypoint:
            [
              "sh", "/var/lib/arangodb/import/arangoDBImport.sh", "tcp://{db_name}:8529" , "1"
            ]
          networks:
            - Shared_net
        """).strip("\n")
    elif database == "mongodb":  # mongodb
        db_url = f"mongodb://{db_name}:27017"
        databaseService = dedent(f"""
        {db_name}:
          image: mongo:8.0.14-rc0
          container_name: {db_name}
          ports:
            - "{protocol_port}:27017"
          volumes:
            - {PRELOAD_DATA}:/var/lib/mongodb/import
          healthcheck:
            test: echo 'db.runCommand("ping").ok' | mongosh mongodb://{db_name}:27017/ --quiet
            interval: 10s
            timeout: 5s
            retries: 5
          networks:
              - Shared_net
        {preloadName}:
          image: mongo:8.0.14-rc0
          container_name: preload{i+1}
          depends_on:
            {db_name}:
              condition: service_healthy
          volumes:
            - {PRELOAD_DATA}:/var/lib/mongodb/import
          entrypoint: 
            ["/var/lib/mongodb/import/mongoDBImport.sh", "{db_name}:27017"]
          networks:
            - Shared_net
          
        """).strip("\n")
    # elif database == "nebulagraph":  # nebulagraph
    #     db_url = f"http://{db_name}:7687"
    #     databaseService = dedent(f"""
    #     {db_name}:
    #       image: vesoft/nebula-graphd:latest
    #       container_name: {db_name}
    #       environment:
    #         TZ: "UTC"
    #       healthcheck:
    #         test: ["CMD-SHELL", "echo 'SHOW HOSTS;' | nebula-console -u root -p nebula --address {db_name} --port 3699 || exit 1"]
    #         interval: 10s
    #         timeout: 5s
    #         retries: 5
    #       ports:
    #         - "{protocol_port}:3699"
    #       networks:
    #         - Shared_net
    #     """).strip("\n")  
    else:
        print(f"Unsupported database: {database}")
        sys.exit(1)



        
    environment = dedent(f"""
    WS_URI: "ws://wsserver:1234"
    DATABASE_URI: {db_url}
    NEO4J_USER: "{db_user}"
    NEO4J_PASSWORD: "{password}"
    USER: {db_user}
    DATABASE: {database.upper()}
    LOG_LEVEL: {app_log_level}
    IS_PRELOAD_LEADER: {"Yes" if i==0 and replica_idx==0 else "No"}
    REPLICA_ID: "{replica_id}"
    PEER_REPLICA_ID: "{peer_replica_id}"
    PEER_DC_ID: "{peer_dc_id}"
    DATACENTER_ID: "{dc_name}"
    ACK_LEVEL: "{ack_level}"
    """).strip("\n")


    
# indent to exact nesting levels
    databaseService_block = indent(databaseService, "  ")  # under `services:`
    environment_block = indent(environment, "      ")    # under `environment:`
    preloadWaitBlock = dedent(f"""
    {preloadName}:
        condition: service_completed_successfully
        """).strip("\n")


    lines = [
        f"name: GraceReplica{i+1}",
        "services:",
        databaseService_block,
        "",
        f"  {app_name}:",
        "    build:",
        "      context: ../",
        "      dockerfile: ./Dockerfiles/GRACEDockerfile",
        f"    container_name: {grace_name}",
        "    ports:",
        f'      - "{app_port}:3000"',
        "    environment:",
        environment_block,
        "    cap_add:",
        "       - NET_ADMIN",
        "    depends_on:",
        f"      {db_name}:",
        "        condition: service_healthy",
        f"      {preloadName}:",
        "         condition: service_completed_successfully",
        "    networks:",
        f"      - Shared_net",
        "    volumes:",
        f"      - {PRELOAD_DATA}:/var/lib/grace/import",
        "networks:",
        f"  Shared_net:",
        f"    external: true",
  preload_block

    ]

    content = "\n".join(lines) + "\n"
    filename = f"./Dockerfiles/docker-compose.{i+1}.yml"
    with open(filename, "w") as f:
        f.write(content)
    print(f"Generated {filename}")
    return filename
  
def generate_all():
    config = load_config()
    files = []
    external_network_instances = []
    
    if(config["provider"]):
      provider = generate_provider(config, external_network_instances)
      files.append(provider) 
    
    # New configuration structure with datacenters
    if "datacenters" in config:
        datacenters = config["datacenters"]
        replicas_per_dc = config.get("replicas_per_dc", 2)
        
        for dc_idx, dc_conf in enumerate(datacenters):
            for replica_idx in range(replicas_per_dc):
                files.append(generate_compose_file(dc_idx, replica_idx, dc_conf, config))
    else:
        # Legacy support for old configuration (1 replica per DC)
        # Each entry in 'dbs' represents one datacenter with one replica
        n = len(config['dbs'])
        # Ensure replicas_per_dc is set to 1 for legacy format
        if 'replicas_per_dc' not in config:
            config['replicas_per_dc'] = 1
        for i in range(n):
            # dc_idx = i, replica_idx = 0 (single replica per DC)
            files.append(generate_compose_file(i, 0, config['dbs'][i], config))
    
    return files

def up_all():
    config = load_config()
    files = generate_all()
    existing_files = [
      (os.path.join("./Dockerfiles", f))
      for f in os.listdir("./Dockerfiles")
      if os.path.isfile(os.path.join("./Dockerfiles", f)) and f.lower().endswith(('.yaml', '.yml'))
    ]

    for file in existing_files:
      if file not in files:
          print(f"Deleting {file} ...")
          os.remove(file)

    for file in files:
      print("filename"+file)
      stack_name = get_stack_name(file)
      if not stack_name:
          print(f"⚠️ No 'name' found in {file}, skipping")
          continue
      running = is_stack_running(stack_name)
      status = " ✅ Running" if running else "⚠️ Not running, will start"
      print(f"{stack_name}: {status}")
      if not running:
          run_command(["docker","compose", "-f", file, "up","--build", "-d", "--force-recreate"])
      else:
          continue
    # if(config["provider"]):
    #   run_command(["docker","compose", "-f", './Dockerfiles/docker-compose.provider.yml', "up","--build", "-d", "--force-recreate"])

def get_stack_name(compose_file):
    # Extract the project name from the compose file's 'name' field.
    with open(compose_file, 'r') as f:
        try:
            data = yaml.safe_load(f)
            return data.get('name', None)
        except yaml.YAMLError as e:
            print(f"YAML error in {compose_file}: {e}")
            return None

def is_stack_running(stack_name):
    """Check if a docker compose project is running."""
    try:
        result = subprocess.run(
            ['docker', 'compose', '-p', stack_name, 'ps', '--status', 'running'],
            capture_output=True, text=True
        )
        return "Up" in result.stdout
    except Exception as e:
        print(f"Error checking {stack_name}: {e}")
        return False

def down_all():
    config = load_config()
    
    # Determine total number of replicas
    if "datacenters" in config:
        num_datacenters = len(config["datacenters"])
        replicas_per_dc = config.get("replicas_per_dc", 2)
        total_replicas = num_datacenters * replicas_per_dc
    else:
        total_replicas = len(config["dbs"])
    
    for i in range(total_replicas):
        file = f"docker-compose.{i+1}.yml"
        network = f"Grace_net_{i+1}"
        print(f"Stopping containers from {'./Dockerfiles/'+file}...")

        run_command(["docker","compose", "-f", './Dockerfiles/'+file , "down"])
        print(f"Removing network {network}...")
        run_command(["docker", "network", "rm", network])
    if (config["provider"]):
        run_command(["docker","compose", "-f", './Dockerfiles/docker-compose.provider.yml' , "down"])
    run_command(["docker", "network", "rm", "Shared_net"])
        
def force_clean():
  config = load_config()
  
  # Determine total number of replicas
  if "datacenters" in config:
      num_datacenters = len(config["datacenters"])
      replicas_per_dc = config.get("replicas_per_dc", 2)
      total_replicas = num_datacenters * replicas_per_dc
  else:
      total_replicas = len(config['dbs'])
  
  files = [f'./Dockerfiles/docker-compose.{i+1}.yml' for i in range(total_replicas)]
  if config.get('provider'):
    files.append('./Dockerfiles/docker-compose.provider.yml')
    
  for file in files:
    print(f'Tearing down {file} (containers, networks, images, volumes)')
    
    run_command(["docker", "compose", "-f", file, "down", "--remove-orphans", "--volumes", "--rmi", "local"])

  patterns = [
    r"^(neo4j|memgraph)\d+$",
    r"^lab\d+$",
    r"^Grace\d+$",
    r"^Prometheus\d+$",
    r"^Grafana\d+$",
    r"^wsserver$",
  ]
  try:
    names_output = subprocess.check_output(
      ["docker", "ps", "-a", "--format", "{{.Names}}"], text=True
    )
    for name in names_output.splitlines():
      if any(re.match(p, name) for p in patterns):
          print(f"Removing left-over container {name}...")
          run_command(["docker", "rm", "-f", name])
  except Exception: pass
  
  net_patterns = [r"^Grace_net_\d+$", r"^Provider_net$"]
  try:
      nets_output = subprocess.check_output(
          ["docker", "network", "ls", "--format", "{{.Name}}"], text=True
      )
      for net in nets_output.splitlines():
          if any(re.match(p, net) for p in net_patterns):
              print(f"Removing network {net}...")
              run_command(["docker", "network", "rm", net])
  except Exception: pass
    
  ########Uncomment to remove any unused containers, images and volumes 
   
  run_command(["docker", "container", "prune", "-f"])
  run_command(["docker", "image", "prune", "-f"])
  run_command(["docker", "volume", "prune", "-f"])
  ### Remove docker files?
  
  

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["generate","up", "down", "force-clean","rebuild"], help="Deployment Actions.")
    parser.add_argument("distconf", help="Distribution configuration file", default="DistributionConfig.json", nargs='?')
    parser.add_argument("-v", "--verbose", action="store_true", help="Show full output when deploying.")
    
    # parser.add_argument("-b", "--benchmark", action="store_true", help="Preload the database with snapshot data.")
    args = parser.parse_args()

    VERBOSE = args.verbose 
    command = args.command
    PATH= args.distconf
    PRELOAD_DATA = os.environ.get("PRELOAD_DATA", False)

    # BENCHMARK = args.benchmark
    
    if command == "generate":
        generate_all()
    elif command == "up":
        up_all()
    # elif command == "add-replica":
    #     add_stack()
    elif command == "down":
        down_all()
    elif command == "force-clean":    
        force_clean()
    elif command == "rebuild":
        down_all()
        up_all()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)