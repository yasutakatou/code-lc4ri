# Docker で作る Web/DB 二階層システム 入門チュートリアル

> **対象読者**: Docker・コンテナが初めての方  
> **構成**: Nginx（Web サーバー） + MySQL（DB サーバー）

---

## アーキテクチャ概要

```
ブラウザ / curl
      │  HTTP :8080
  [nginx コンテナ]   ← tutorial-network (公開ポート 8080)
      │  MySQL :3306
  [mysql コンテナ]   ← tutorial-network (外部非公開)
```

両コンテナは同じ Docker ネットワーク内に置き、
Web からのみ DB へ接続できる構成にします。

---

## 事前準備

### Docker のインストール確認

```bash
docker --version
```



> Docker がインストールされていない場合は https://docs.docker.com/get-docker/ を参照してください。

---

## Step 1: 作業ディレクトリと設定ファイルの準備

### 1-1. 作業ディレクトリの作成

```bash
mkdir -p ./docker-tutorial
cd ./docker-tutorial
```




### 確認

```bash
pwd
ls -la
```



---

### 1-2. Nginx 設定ファイルの作成

Nginx が返す HTML ページを用意します。

- write: ./index.html
```
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>Docker Two-Tier Tutorial</title></head>
<body>
  <h1>Hello from Nginx + MySQL on Docker!</h1>
  <p>Web/DB 二階層システムへようこそ。</p>
</body>
</html>
```



### 確認

```bash
pwd
ls -la
```

  

---

### 1-3. Nginx カスタム設定ファイルの作成

- write: ./default.conf
```
server {
    listen       80;
    server_name  localhost;

    location / {
        root   /usr/share/nginx/html;
        index  index.html;
    }

    # ヘルスチェック用エンドポイント
    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
```



### 確認

```bash
ls -la default.conf
```



---

### 1-4. MySQL 初期化スクリプトの作成

コンテナ起動時に自動でテーブルとサンプルデータを作成します。

- write: ./init.sql
```
-- データベースを選択
USE tutorialdb;

-- メッセージテーブルの作成
CREATE TABLE IF NOT EXISTS messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  body       VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- サンプルデータの投入
INSERT INTO messages (body) VALUES ('Hello from MySQL!');
INSERT INTO messages (body) VALUES ('Docker 二階層システム 構築成功！');
```



### 確認

```bash
ls -la init.sql
```



---

### 1-5. ディレクトリ構成の最終確認

```bash
pwd
find ./ -type f
```



---

## Step 2: Docker ネットワークの作成

コンテナ同士が通信するための専用ネットワークを作成します。

```bash
docker network create tutorial-network
```



```bash
docker network ls | grep tutorial
docker network inspect tutorial-network \
  --format '{{.Name}} / Driver:{{.Driver}} / Subnet:{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```



---

## Step 3: MySQL コンテナの起動

### 3-1. MySQL コンテナの起動

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



| `-d` | バックグラウンドで起動 |
| `--name` | コンテナ名 |
| `--network` | 接続するネットワーク |
| `-e` | 環境変数（DB名・パスワード等） |
| `-v` | 初期化 SQL をマウント |

### 確認（起動まで 10〜20 秒待つ）

```bash
# コンテナの状態確認
docker ps --filter name=tutorial-db
# ログで初期化完了を確認
docker logs tutorial-db 2>&1 | tail -20
```



✅ `ready for connections` が表示されれば MySQL は正常に起動しています。

---

## Step 4: Nginx コンテナの起動

### 4-1. Nginx コンテナの起動

```bash
docker run -d \
  --name tutorial-web \
  --network tutorial-network \
  -p 8080:80 \
  -v ./index.html:/usr/share/nginx/html/index.html \
  -v ./default.conf:/etc/nginx/conf.d/default.conf \
  nginx:1.25
```



| オプション | 意味 |
|------------|------|
| `-p 8080:80` | ホストの 8080 → コンテナの 80 に転送 |
| `-v` | HTML・設定ファイルをマウント |

### 確認

```bash
# コンテナの状態確認
docker ps --filter name=tutorial-web
# ログ確認
docker logs tutorial-web
```



## Step 5: 動作確認

### 5-1. 全コンテナの起動状態を確認

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```



---

### 5-2. Web サーバーへの HTTP アクセス確認

```bash
curl http://localhost:8080/
```



✅ `Hello from Nginx + MySQL on Docker!` が含まれた HTML が返れば Web サーバーは正常です。

```bash
# ヘルスチェックエンドポイントの確認
curl http://localhost:8080/health
```



✅ `OK` が返れば Nginx の設定も正常です。

---

### 5-3. DB への直接接続確認

```bash
docker exec -it tutorial-db \
  mysql -u webuser -pwebpass tutorialdb \
  -e "SELECT * FROM messages;"
```



---

### 5-4. Web コンテナ → DB コンテナの疎通確認

Web サーバー（Nginx コンテナ）の中から DB へ接続できることを確認します。

```bash
docker exec -it tutorial-web bash -c \
  "apt-get install -y -q default-mysql-client 2>/dev/null; \
   mysql -h tutorial-db -u webuser -pwebpass tutorialdb \
   -e 'SELECT body, created_at FROM messages ORDER BY id;'"
```



---

### 5-5. ネットワーク接続状況の確認

```bash
docker network inspect tutorial-network \
  --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{"\n"}}{{end}}'
```



✅ `tutorial-web` と `tutorial-db` の両コンテナが同じネットワークに属していることが確認できます。

---

## Step 6: クリーンアップ

> ⚠️ **注意**: 以下の手順を実行するとコンテナ・ネットワーク・作業ファイルがすべて削除されます。

### 6-1. コンテナの停止

```bash
docker stop tutorial-web tutorial-db
```



```bash
docker ps --filter name=tutorial
```



✅ 何も表示されなければ停止完了です。

---

### 6-2. コンテナの削除

```bash
docker rm tutorial-web tutorial-db
```



### 確認

```bash
docker ps -a --filter name=tutorial
```



✅ 何も表示されなければ削除完了です。

---

### 6-3. Docker ネットワークの削除

```bash
docker network rm tutorial-network
```


```bash
docker network ls | grep tutorial
```



✅ 何も表示されなければ削除完了です。

---

### 6-4. Docker イメージの削除（任意）

> ローカルにダウンロードされたイメージも不要な場合は削除します。

```bash
docker rmi nginx:1.25 mysql:8.0
```



```bash
docker images | grep -E "nginx|mysql"
```



---

### 6-5. 作業ファイルの削除

```bash
cd ../
rm -rf ./docker-tutorial
```

### 確認

```bash
ls ./docker-tutorial 2>/dev/null || echo "ディレクトリ削除済み ✅"
```



---

### 6-6. 最終クリーンアップ確認

```bash
echo "=== 残存コンテナ確認 ==="
docker ps -a --filter name=tutorial
echo "=== 残存ネットワーク確認 ==="
docker network ls --filter name=tutorial
echo "=== 作業ディレクトリ確認 ==="
ls ./docker-tutorial 2>/dev/null || echo "削除済み"
```



---

## まとめ

| ステップ | 内容 |
|----------|------|
| Step 1 | 作業ディレクトリと設定ファイル（HTML・Nginx conf・init.sql）の作成 |
| Step 2 | コンテナ間通信用の Docker ネットワーク作成 |
| Step 3 | MySQL コンテナの起動（初期 DB・テーブル・データ自動生成） |
| Step 4 | Nginx コンテナの起動（ポート 8080 公開） |
| Step 5 | HTTP 疎通・DB 直接接続・Web→DB 通信の動作確認 |
| Step 6 | 全リソース（コンテナ・ネットワーク・イメージ・ファイル）のクリーンアップ |

お疲れさまでした！🎉 これで Docker を使った Web/DB 二階層システムの構築が完了です。
