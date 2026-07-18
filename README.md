# 一生足迹 CSV 浏览器地图

把「一生足迹」iOS App 导出的 CSV 放到服务器本地，用 Docker Compose 启动后，在浏览器里查看足迹点、日期筛选、单日轨迹和热力图。

数据只在本机或服务器本地读取处理，不需要数据库，也不会上传到第三方服务。地图底图地址可配置，默认使用 OpenStreetMap 公共瓦片。

## 项目结构

```text
.
├── docker-compose.yml
├── Dockerfile
├── README.md
├── .gitignore
├── .env.example
├── config.example.json
├── app/
│   ├── main.py
│   ├── parser.py
│   └── static/
│       ├── index.html
│       ├── app.js
│       └── style.css
└── data/
    └── .gitkeep
```

## 放置 CSV

把「一生足迹」iOS App 导出的 CSV 文件放到：

```bash
data/footprint.csv
```

如果 `data/footprint.csv` 不存在，页面会提示：请把一生足迹导出的 CSV 放到 data/footprint.csv。

## 本地启动

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:8096
```

## 部署到服务器

```bash
git clone <你的仓库地址>
cd <项目目录>
mkdir -p data
```

把 CSV 放到：

```bash
data/footprint.csv
```

启动：

```bash
docker compose up -d --build
```

浏览器访问：

```text
http://服务器IP:8096
```

健康检查：

```text
http://服务器IP:8096/health
```

## 更新

```bash
git pull
docker compose up -d --build
```

## 修改端口

复制环境变量示例：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
APP_PORT=8096
```

`docker-compose.yml` 默认使用：

```yaml
"${APP_PORT:-8096}:8000"
```

容器内部服务端口是 `8000`，宿主机默认访问端口是 `8096`。

## 配置字段映射

程序会自动识别常见字段名：

- 时间 / 日期 / timestamp / time / date
- 经度 / longitude / lng / lon
- 纬度 / latitude / lat
- 地址 / address
- 城市 / city
- 省份 / province / state
- 国家 / country
- 海拔 / altitude
- 速度 / speed

如果识别失败，复制示例配置：

```bash
cp config.example.json config.json
```

然后修改 `config.json` 里的 `field_mapping`，把右侧改成你 CSV 中真实的列名：

```json
{
  "field_mapping": {
    "time": "时间",
    "longitude": "经度",
    "latitude": "纬度",
    "address": "地址",
    "city": "城市",
    "province": "省份",
    "country": "国家",
    "altitude": "海拔",
    "speed": "速度"
  }
}
```

## 配置地图底图

可以在 `.env` 中修改底图：

```bash
TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
TILE_ATTRIBUTION=&copy; OpenStreetMap contributors
```

也可以在 `config.json` 中配置：

```json
{
  "tile_url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "tile_attribution": "&copy; OpenStreetMap contributors"
}
```

## 隐私提醒

不要把真实 `footprint.csv` 上传到 GitHub。项目的 `.gitignore` 已经忽略以下真实数据文件：

```text
data/*.csv
data/*.xlsx
data/*.xls
data/*.json
data/*.zip
config.json
```

只提交代码、示例配置和 `data/.gitkeep`。
