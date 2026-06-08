# Docker Two-Tier Web/DB System Tutorial for Beginners

> **Target audience**: Those new to Docker and containers
> **Stack**: Nginx (Web server) + MySQL (DB server)

---

## Architecture Overview

```
Browser / curl
      │  HTTP :8080
  [nginx container]   ← tutorial-network (published port 8080)
      │  MySQL :3306
  [mysql container]   ← tutorial-network (not exposed externally)
```

Both containers are placed on the same Docker network,
so only the Web container can connect to the DB.

---

## Prerequisites

### Verify Docker Installation

```bash
docker --version
```



> If Docker is not installed, refer to https://docs.docker.com/get-docker/

---

## Step 1: Prepare Working Directory and Configuration Files

### 1-1. Create Working Directory

```bash
mkdir -p ./docker-tutorial
cd ./docker-tutorial
```




### Verify

```bash
pwd
ls -la
```



---

### 1-2. Create Nginx HTML File

Prepare the HTML page that Nginx will serve.

- write: ./index.html
```
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>Docker Two-Tier Tutorial</title></head>
<body>
  <h1>Hello from Nginx + MySQL on Docker!</h1>
  <p>Welcome to the Web/DB two-tier system.</p>
</body>
</html>
```



### Verify

```bash
pwd
ls -la
```

  

---

### 1-3. Create Nginx Custom Configuration File

- write: ./default.conf
```
server {
    listen       80;
    server_name  localhost;

    location / {
        root   /usr/share/nginx/html;
        index  index.html;
    }

    # Health check endpoint
    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
```



### Verify

```bash
ls -la default.conf
```



---

### 1-4. Create MySQL Initialization Script

This script automatically creates tables and inserts sample data when the container starts.

- write: ./init.sql
```
-- Select the database
USE tutorialdb;

-- Create the messages table
CREATE TABLE IF NOT EXISTS messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  body       VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO messages (body) VALUES ('Hello from MySQL!');
INSERT INTO messages (body) VALUES ('Docker two-tier system setup complete!');
```



### Verify

```bash
ls -la init.sql
```



---

### 1-5. Final Check of Directory Structure

```bash
pwd
find ./ -type f
```



---

## Step 2: Create Docker Network

Create a dedicated network for container-to-container communication.

```bash
docker network create tutorial-network
```



```bash
docker network ls | grep tutorial
docker network inspect tutorial-network \
  --format '{{.Name}} / Driver:{{.Driver}} / Subnet:{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```



---

## Step 3: Start the MySQL Container

### 3-1. Start the MySQL Container

```bash
docker run -d \
  --name tutorial-db \
  --network tutorial-network \
  -e MYSQL_ROOT_PASSWORD=rootpass \
  -e MYSQL_DATABASE=tutorialdb \
  -e MYSQL_USER=webuser \
  -e MYSQL_PASSWORD=webpass \
  -v ./init.sql:/docker-entrypoint-initdb.d/init.sql \
  mysql:8.0
```



| Option | Description |
|--------|-------------|
| `-d` | Run in background (detached mode) |
| `--name` | Container name |
| `--network` | Network to connect to |
| `-e` | Environment variables (DB name, passwords, etc.) |
| `-v` | Mount the initialization SQL file |

### Verify (wait 10–20 seconds for startup)

```bash
# Check container status
docker ps --filter name=tutorial-db
# Confirm initialization is complete via logs
docker logs tutorial-db 2>&1 | tail -20
```



✅ MySQL is running correctly when `ready for connections` appears in the logs.

---

## Step 4: Start the Nginx Container

### 4-1. Start the Nginx Container

```bash
docker run -d \
  --name tutorial-web \
  --network tutorial-network \
  -p 8080:80 \
  -v ./index.html:/usr/share/nginx/html/index.html \
  -v ./default.conf:/etc/nginx/conf.d/default.conf \
  nginx:1.25
```



| Option | Description |
|--------|-------------|
| `-p 8080:80` | Forward host port 8080 → container port 80 |
| `-v` | Mount HTML and configuration files |

### Verify

```bash
# Check container status
docker ps --filter name=tutorial-web
# Check logs
docker logs tutorial-web
```



## Step 5: Verify Operation

### 5-1. Check All Containers Are Running

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```



---

### 5-2. Verify HTTP Access to Web Server

```bash
curl http://localhost:8080/
```



✅ The Web server is working correctly if HTML containing `Hello from Nginx + MySQL on Docker!` is returned.

```bash
# Check the health check endpoint
curl http://localhost:8080/health
```



✅ Nginx configuration is correct if `OK` is returned.

---

### 5-3. Verify Direct DB Connection

```bash
docker exec -it tutorial-db \
  mysql -u webuser -pwebpass tutorialdb \
  -e "SELECT * FROM messages;"
```



---

### 5-4. Verify Web Container → DB Container Connectivity

Confirm that the DB is reachable from inside the Web server (Nginx) container.

```bash
docker exec -it tutorial-web bash -c \
  "apt-get install -y -q default-mysql-client 2>/dev/null; \
   mysql -h tutorial-db -u webuser -pwebpass tutorialdb \
   -e 'SELECT body, created_at FROM messages ORDER BY id;'"
```



---

### 5-5. Check Network Connectivity Status

```bash
docker network inspect tutorial-network \
  --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{"\n"}}{{end}}'
```



✅ Confirms that both `tutorial-web` and `tutorial-db` containers belong to the same network.

---

## Step 6: Cleanup

> ⚠️ **Warning**: The following steps will delete all containers, networks, and working files.

### 6-1. Stop the Containers

```bash
docker stop tutorial-web tutorial-db
```



```bash
docker ps --filter name=tutorial
```



✅ Containers are stopped if nothing is displayed.

---

### 6-2. Remove the Containers

```bash
docker rm tutorial-web tutorial-db
```



### Verify

```bash
docker ps -a --filter name=tutorial
```



✅ Containers are deleted if nothing is displayed.

---

### 6-3. Remove the Docker Network

```bash
docker network rm tutorial-network
```


```bash
docker network ls | grep tutorial
```



✅ Network is deleted if nothing is displayed.

---

### 6-4. Remove Docker Images (Optional)

> Remove the locally downloaded images if they are no longer needed.

```bash
docker rmi nginx:1.25 mysql:8.0
```



```bash
docker images | grep -E "nginx|mysql"
```



---

### 6-5. Remove Working Files

```bash
cd ../
rm -rf ./docker-tutorial
```

### Verify

```bash
ls ./docker-tutorial 2>/dev/null || echo "Directory deleted ✅"
```



---

### 6-6. Final Cleanup Verification

```bash
echo "=== Check for remaining containers ==="
docker ps -a --filter name=tutorial
echo "=== Check for remaining networks ==="
docker network ls --filter name=tutorial
echo "=== Check working directory ==="
ls ./docker-tutorial 2>/dev/null || echo "Deleted"
```



---

## Summary

| Step | Content |
|------|---------|
| Step 1 | Create working directory and configuration files (HTML, Nginx conf, init.sql) |
| Step 2 | Create Docker network for inter-container communication |
| Step 3 | Start MySQL container (auto-create initial DB, tables, and data) |
| Step 4 | Start Nginx container (publish port 8080) |
| Step 5 | Verify operation: HTTP connectivity, direct DB connection, Web→DB communication |
| Step 6 | Clean up all resources (containers, networks, images, files) |

Well done! 🎉 You have successfully built a Web/DB two-tier system using Docker.
