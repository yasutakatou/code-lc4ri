# Kubernetes Two-Tier Web/DB System Tutorial for Beginners

> **Target audience**: Those new to Kubernetes and manifests
> **Stack**: Nginx (Web server) + MySQL (DB server)

---

## Architecture Overview

```
Browser / curl
      │  NodePort :30080
  [Service: web-service]
      │
  [Deployment: web]        ← Nginx Pod × 2
      │  ClusterIP :3306
  [Service: db-service]
      │
  [Deployment: db]         ← MySQL Pod × 1
      │
  [PersistentVolumeClaim]  ← Data persistence
```

All resources are managed under the `tutorial` Namespace.

---

## Prerequisites

### Verify kubectl Installation

```bash
kubectl version --client
```



Expected output example:
```
Client Version: v1.29.x
```

### Verify Cluster Connection

```bash
kubectl cluster-info
kubectl get nodes
```



✅ Setup is complete when nodes are in the `Ready` state.

> For local environments, use [minikube](https://minikube.sigs.k8s.io/) or [kind](https://kind.sigs.k8s.io/).
> Start minikube with: `minikube start`

---

## Step 1: Prepare Working Directory and Manifests

### 1-1. Create Working Directory

```bash
mkdir -p ./k8s-tutorial
cd ./k8s-tutorial
```
```



---

### 1-2. Create Namespace Manifest

Define a dedicated Namespace to logically group all resources.

- write: ./00-namespace.yaml
```
apiVersion: v1
kind: Namespace
metadata:
  name: tutorial
  labels:
    app: two-tier-tutorial
```



### Verify

```bash
ls -la ./00-namespace.yaml
```



---

### 1-3. Create MySQL Secret Manifest

Manage passwords as a Secret resource (Base64-encoded).

- write: ./01-secret.yaml
```
apiVersion: v1
kind: Secret
metadata:
  name: mysql-secret
  namespace: tutorial
type: Opaque
data:
  root-password: cm9vdHBhc3M=   # rootpass
  user-password: d2VicGFzcw==   # webpass
```



### Verify

```bash
ls -la ./01-secret.yaml
```



---

### 1-4. Create MySQL ConfigMap Manifest

Manage the initialization SQL as a ConfigMap.

- write: ./02-configmap.yaml
```
apiVersion: v1
kind: ConfigMap
metadata:
  name: mysql-initdb
  namespace: tutorial
data:
  init.sql: |
    USE tutorialdb;
    CREATE TABLE IF NOT EXISTS messages (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      body       VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO messages (body) VALUES ('Hello from Kubernetes!');
    INSERT INTO messages (body) VALUES ('Web/DB two-tier system setup complete!');
```



### Verify

```bash
ls -la ./02-configmap.yaml
```



---

### 1-5. Create MySQL PersistentVolumeClaim Manifest

Define storage to persist DB data across container restarts.

- write: ./03-pvc.yaml
```
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pvc
  namespace: tutorial
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```



### Verify

```bash
ls -la ./03-pvc.yaml
```



---

### 1-6. Create MySQL Deployment + Service Manifest

- write: ./04-db.yaml
```
# ── DB Deployment ──────────────────────────────────────
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  namespace: tutorial
spec:
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          ports:
            - containerPort: 3306
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: root-password
            - name: MYSQL_DATABASE
              value: tutorialdb
            - name: MYSQL_USER
              value: webuser
            - name: MYSQL_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: user-password
          volumeMounts:
            - name: mysql-data
              mountPath: /var/lib/mysql
            - name: initdb
              mountPath: /docker-entrypoint-initdb.d
      volumes:
        - name: mysql-data
          persistentVolumeClaim:
            claimName: mysql-pvc
        - name: initdb
          configMap:
            name: mysql-initdb
---
# ── DB Service (ClusterIP: exposed only within the cluster) ──────
apiVersion: v1
kind: Service
metadata:
  name: db-service
  namespace: tutorial
spec:
  selector:
    app: db
  ports:
    - port: 3306
      targetPort: 3306
  type: ClusterIP
```



### Verify

```bash
ls -la 04-db.yaml
```



---

### 1-7. Create Nginx ConfigMap Manifest

- write: ./05-nginx-config.yaml
```
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: tutorial
data:
  index.html: |
    <!DOCTYPE html>
    <html lang="ja">
    <head><meta charset="UTF-8"><title>Kubernetes Two-Tier Tutorial</title></head>
    <body>
      <h1>Hello from Nginx on Kubernetes!</h1>
      <p>Welcome to the Web/DB two-tier system.</p>
    </body>
    </html>
  default.conf: |
    server {
        listen       80;
        server_name  localhost;
        location / {
            root  /usr/share/nginx/html;
            index index.html;
        }
        location /health {
            return 200 'OK';
            add_header Content-Type text/plain;
        }
    }
```



### Verify

```bash
ls -la ./05-nginx-config.yaml
```



---

### 1-8. Create Nginx Deployment + Service Manifest

- write: ./06-web.yaml
```
# ── Web Deployment ─────────────────────────────────────
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: tutorial
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.25
          ports:
            - containerPort: 80
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html/index.html
              subPath: index.html
            - name: conf
              mountPath: /etc/nginx/conf.d/default.conf
              subPath: default.conf
      volumes:
        - name: html
          configMap:
            name: nginx-config
            items:
              - key: index.html
                path: index.html
        - name: conf
          configMap:
            name: nginx-config
            items:
              - key: default.conf
                path: default.conf
---
# ── Web Service (NodePort: accessible from outside the cluster) ────────
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: tutorial
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
  type: NodePort
```



### Verify

```bash
ls -la ./06-web.yaml
```



---

### 1-9. Verify List of Manifest Files

```bash
ls -la
```



---

## Step 2: Deploy Resources

Apply manifests in numbered order. The sequence matters due to dependencies (Namespace → Secret → DB → Web).

### 2-1. Create Namespace

```bash
kubectl apply -f 00-namespace.yaml
```



```

```bash
kubectl get namespace tutorial
```



---

### 2-2. Create Secret / ConfigMap / PVC

```bash
kubectl apply -f 01-secret.yaml
kubectl apply -f 02-configmap.yaml
kubectl apply -f 03-pvc.yaml
```



```bash
kubectl get secret,configmap,pvc -n tutorial
```



### 2-3. Deploy DB (MySQL)

```bash
kubectl apply -f 04-db.yaml
```



```bash
kubectl get pods -n tutorial -l app=db -w
```




✅ Press `Ctrl+C` to exit once `STATUS` shows `Running`.

```bash
kubectl get service db-service -n tutorial
```



---

### 2-4. Deploy Web (Nginx)

```bash
kubectl apply -f 05-nginx-config.yaml
kubectl apply -f 06-web.yaml
```



```bash
kubectl get pods -n tutorial -l app=web
kubectl get service web-service -n tutorial
```



### 2-5. Verify All Resource Status

```bash
kubectl get all -n tutorial
```



---

## Step 3: Verify Operation

### 3-1. Verify HTTP Access to Web Server


```bash
kubectl port-forward service/web-service 8080:80 -n tutorial &
curl http://localhost:8080/
```



✅ The Web server is working correctly if HTML containing `Hello from Nginx on Kubernetes!` is returned.

```bash
curl http://localhost:8080/health
```

✅ Nginx configuration is correct if `OK` is returned.

---

### 3-2. Verify DB Connection

```bash
kubectl exec -it \
  $(kubectl get pod -n tutorial -l app=db -o jsonpath='{.items[0].metadata.name}') \
  -n tutorial \
  -- mysql -u webuser -pwebpass tutorialdb \
  -e "SELECT * FROM messages;"
```



---

### 3-3. Check Pod and Service Details

```bash
# Pod details (IP addresses, Node placement)
kubectl get pods -n tutorial -o wide
# Service details (endpoint verification)
kubectl get endpoints -n tutorial
```



### 3-4. Check Logs

```bash
# Web Pod logs
kubectl logs -l app=web -n tutorial --prefix
# DB Pod logs (last 20 lines)
kubectl logs -l app=db -n tutorial --tail=20
```



## Step 4: Cleanup

> ⚠️ **Warning**: The following steps will delete all resources.

### 4-1. Delete Deployments and Services

```bash
kubectl delete -f ./06-web.yaml
kubectl delete -f ./05-nginx-config.yaml
kubectl delete -f ./04-db.yaml
```



```bash
kubectl get pods -n tutorial
```



---

### 4-2. Delete PVC / ConfigMap / Secret

```bash
kubectl delete -f ./03-pvc.yaml
kubectl delete -f ./02-configmap.yaml
kubectl delete -f ./01-secret.yaml
```



```bash
kubectl get secret,configmap,pvc -n tutorial
```



---

### 4-3. Delete Namespace

Deleting the Namespace will also bulk-delete any remaining resources within it.

```bash
kubectl delete -f ./00-namespace.yaml
```



```bash
kubectl get namespace tutorial
```



✅ Deletion is complete when `Error from server (NotFound)` is displayed.

---

### 4-4. Delete Working Files

```bash
cd ../
rm -rf k8s-tutorial
```



### Verify

```bash
ls k8s-tutorial 2>/dev/null || echo "Directory deleted ✅"
```



---

### 4-5. Final Cleanup Verification

```bash
echo "=== Check Namespace ==="
kubectl get namespace tutorial 2>&1
echo "=== Check for remaining resources ==="
kubectl get all -n tutorial 2>&1
echo "=== Check working files ==="
ls ~/k8s-tutorial 2>/dev/null || echo "Deleted"
```



---

## Kubernetes Resource Quick Reference

| Resource | Role | Usage in This Tutorial |
|----------|------|------------------------|
| `Namespace` | Logical isolation unit for resources | `tutorial` namespace |
| `Secret` | Manages sensitive information | DB passwords |
| `ConfigMap` | Manages configuration files and text | Initialization SQL, HTML, Nginx conf |
| `PersistentVolumeClaim` | Requests persistent storage | MySQL data storage |
| `Deployment` | Declarative Pod management and auto-recovery | Web (×2), DB (×1) |
| `Service (ClusterIP)` | Fixed endpoint for intra-cluster communication | Internal DB communication |
| `Service (NodePort)` | Externally accessible endpoint | External Web access |

---

## Summary

| Step | Content |
|------|---------|
| Step 1 | Create 7 manifest files (Namespace / Secret / ConfigMap / PVC / DB / Nginx config / Web) |
| Step 2 | Deploy resources in dependency order using `kubectl apply` |
| Step 3 | Three-stage verification: HTTP connectivity, direct DB connection, Web→DB communication (DNS resolution) |
| Step 4 | Delete all resources in reverse order + final verification |

Well done! 🎉 You have successfully built a Web/DB two-tier system using Kubernetes.
