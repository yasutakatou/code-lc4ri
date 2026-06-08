# Kubernetes で作る Web/DB 二階層システム 入門チュートリアル

> **対象読者**: Kubernetes・マニフェストが初めての方  
> **構成**: Nginx（Web サーバー） + MySQL（DB サーバー）

---

## アーキテクチャ概要

```
ブラウザ / curl
      │  NodePort :30080
  [Service: web-service]
      │
  [Deployment: web]        ← Nginx Pod × 2
      │  ClusterIP :3306
  [Service: db-service]
      │
  [Deployment: db]         ← MySQL Pod × 1
      │
  [PersistentVolumeClaim]  ← データ永続化
```

すべてのリソースは `tutorial` Namespace にまとめて管理します。

---

## 事前準備

### kubectl のインストール確認

```bash
kubectl version --client
```



期待する出力例:
```
Client Version: v1.29.x
```

### クラスター接続確認

```bash
kubectl cluster-info
kubectl get nodes
```



✅ ノードが `Ready` 状態であれば準備完了です。

> ローカル環境で試す場合は [minikube](https://minikube.sigs.k8s.io/) または [kind](https://kind.sigs.k8s.io/) をご利用ください。  
> minikube の起動: `minikube start`

---

## Step 1: 作業ディレクトリとマニフェストの準備

### 1-1. 作業ディレクトリの作成

```bash
mkdir -p ./k8s-tutorial
cd ./k8s-tutorial
```
```



---

### 1-2. Namespace マニフェストの作成

リソースを論理的にまとめる専用 Namespace を定義します。

- write: ./00-namespace.yaml
```
apiVersion: v1
kind: Namespace
metadata:
  name: tutorial
  labels:
    app: two-tier-tutorial
```



### 確認

```bash
ls -la ./00-namespace.yaml
```



---

### 1-3. MySQL 用 Secret マニフェストの作成

パスワードを Secret リソースとして管理します（Base64 エンコード済み）。

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



### 確認

```bash
ls -la ./01-secret.yaml
```



---

### 1-4. MySQL 用 ConfigMap マニフェストの作成

初期化 SQL を ConfigMap として管理します。

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
    INSERT INTO messages (body) VALUES ('Web/DB 二階層システム 構築成功！');
```



### 確認

```bash
ls -la ./02-configmap.yaml
```



---

### 1-5. MySQL 用 PersistentVolumeClaim マニフェストの作成

DB データをコンテナ再起動後も保持するためのストレージを定義します。

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



### 確認

```bash
ls -la ./03-pvc.yaml
```



---

### 1-6. MySQL Deployment + Service マニフェストの作成

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
# ── DB Service (ClusterIP: クラスター内部のみ公開) ──────
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



### 確認

```bash
ls -la 04-db.yaml
```



---

### 1-7. Nginx 用 ConfigMap マニフェストの作成

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
      <p>Web/DB 二階層システムへようこそ。</p>
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



### 確認

```bash
ls -la ./05-nginx-config.yaml
```



---

### 1-8. Nginx Deployment + Service マニフェストの作成

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
# ── Web Service (NodePort: 外部からアクセス可能) ────────
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



### 確認

```bash
ls -la ./06-web.yaml
```



---

### 1-9. マニフェストファイル一覧の確認

```bash
ls -la
```



---

## Step 2: リソースのデプロイ

番号順に apply します。依存関係（Namespace → Secret → DB → Web）があるため順序が重要です。

### 2-1. Namespace の作成

```bash
kubectl apply -f 00-namespace.yaml
```



```

```bash
kubectl get namespace tutorial
```



---

### 2-2. Secret / ConfigMap / PVC の作成

```bash
kubectl apply -f 01-secret.yaml
kubectl apply -f 02-configmap.yaml
kubectl apply -f 03-pvc.yaml
```



```bash
kubectl get secret,configmap,pvc -n tutorial
```



### 2-3. DB（MySQL）のデプロイ

```bash
kubectl apply -f 04-db.yaml
```



```bash
kubectl get pods -n tutorial -l app=db -w
```




✅ `STATUS` が `Running` になったら `Ctrl+C` で抜けます。

```bash
kubectl get service db-service -n tutorial
```



---

### 2-4. Web（Nginx）のデプロイ

```bash
kubectl apply -f 05-nginx-config.yaml
kubectl apply -f 06-web.yaml
```



```bash
kubectl get pods -n tutorial -l app=web
kubectl get service web-service -n tutorial
```



### 2-5. 全リソースの状態確認

```bash
kubectl get all -n tutorial
```



---

## Step 3: 動作確認

### 3-1. Web サーバーへの HTTP アクセス確認


```bash
kubectl port-forward service/web-service 8080:80 -n tutorial &
curl http://localhost:8080/
```



✅ `Hello from Nginx on Kubernetes!` が含まれた HTML が返れば Web サーバーは正常です。

```bash
curl http://localhost:8080/health
```

✅ `OK` が返れば Nginx 設定も正常です。

---

### 3-2. DB への接続確認

```bash
kubectl exec -it \
  $(kubectl get pod -n tutorial -l app=db -o jsonpath='{.items[0].metadata.name}') \
  -n tutorial \
  -- mysql -u webuser -pwebpass tutorialdb \
  -e "SELECT * FROM messages;"
```



---

### 3-3. Pod・Service の詳細確認

```bash
# Pod の詳細（IPアドレス・Node配置）
kubectl get pods -n tutorial -o wide
# Service の詳細（エンドポイント確認）
kubectl get endpoints -n tutorial
```



### 3-4. ログの確認

```bash
# Web Pod のログ
kubectl logs -l app=web -n tutorial --prefix
# DB Pod のログ（最終 20 行）
kubectl logs -l app=db -n tutorial --tail=20
```



## Step 4: クリーンアップ

> ⚠️ **注意**: 以下の手順を実行するとすべてのリソースが削除されます。

### 4-1. Deployment・Service の削除

```bash
kubectl delete -f ./06-web.yaml
kubectl delete -f ./05-nginx-config.yaml
kubectl delete -f ./04-db.yaml
```



```bash
kubectl get pods -n tutorial
```



---

### 4-2. PVC / ConfigMap / Secret の削除

```bash
kubectl delete -f ./03-pvc.yaml
kubectl delete -f ./02-configmap.yaml
kubectl delete -f ./01-secret.yaml
```



```bash
kubectl get secret,configmap,pvc -n tutorial
```



---

### 4-3. Namespace の削除

Namespace を削除すると、残存するリソースもすべて一括削除されます。

```bash
kubectl delete -f ./00-namespace.yaml
```



```bash
kubectl get namespace tutorial
```



✅ `Error from server (NotFound)` が表示されれば削除完了です。

---

### 4-4. 作業ファイルの削除

```bash
cd ../
rm -rf k8s-tutorial
```



### 確認

```bash
ls k8s-tutorial 2>/dev/null || echo "ディレクトリ削除済み ✅"
```



---

### 4-5. 最終クリーンアップ確認

```bash
echo "=== Namespace 確認 ==="
kubectl get namespace tutorial 2>&1
echo "=== 残存リソース確認 ==="
kubectl get all -n tutorial 2>&1
echo "=== 作業ファイル確認 ==="
ls ~/k8s-tutorial 2>/dev/null || echo "削除済み"
```



---

## Kubernetes リソース早見表

| リソース | 役割 | 本チュートリアルでの用途 |
|----------|------|--------------------------|
| `Namespace` | リソースの論理的な分離単位 | `tutorial` 名前空間 |
| `Secret` | 機密情報の管理 | DB パスワード |
| `ConfigMap` | 設定ファイル・テキストの管理 | 初期化 SQL・HTML・Nginx conf |
| `PersistentVolumeClaim` | 永続ストレージの要求 | MySQL データの保存先 |
| `Deployment` | Pod の宣言的管理・自動復旧 | Web (×2)・DB (×1) |
| `Service (ClusterIP)` | クラスター内部向け固定エンドポイント | DB への内部通信 |
| `Service (NodePort)` | 外部からアクセス可能なエンドポイント | Web への外部公開 |

---

## まとめ

| ステップ | 内容 |
|----------|------|
| Step 1 | マニフェスト 7 ファイルの作成（Namespace / Secret / ConfigMap / PVC / DB / Nginx設定 / Web） |
| Step 2 | `kubectl apply` で依存順にリソースをデプロイ |
| Step 3 | HTTP 疎通・DB 直接接続・Web→DB 通信（DNS 解決）の 3 段階動作確認 |
| Step 4 | 全リソースを逆順に削除＋最終確認 |

お疲れさまでした！🎉 これで Kubernetes を使った Web/DB 二階層システムの構築が完了です。
