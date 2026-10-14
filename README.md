# WordLens 划词词典与翻译

Chrome / Microsoft Edge 浏览器扩展。选中英文单词、短语或句子，在原文旁边查看音标、中文释义或翻译，也可以听英语朗读。

## 功能

- **单词**：离线音标、中文释义和英语朗读。
- **短语**：优先查询内置短语词库，未收录时可联网翻译。
- **句子**：英文 → 简体中文翻译及本地英语朗读，单次最多 2000 字符。
- **本地 HTML**：支持 `file:///` 文件，需在扩展详情开启“允许访问文件 URL”。
- 支持 Alt + 选中、关闭自动浮窗、工具栏手动查询和英美口音偏好。

内置 **399,213 个单词、357,828 个短语**，无需构建、账号或 API Key。

![单词释义示例](docs/images/word.png)

![句子翻译示例](docs/images/sentence.png)

## 安装

### 使用安装包

1. 从 [Releases](../../releases) 下载 `WordLens-1.1.2.zip`，全部解压到固定目录。
2. 打开 `edge://extensions` 或 `chrome://extensions`，开启**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的 **wordlens** 文件夹。
4. 刷新已打开的网页，再双击单词或拖选短语、句子。

### 从源码安装

下载或克隆此仓库，在浏览器扩展管理页面加载仓库中的 **extension** 文件夹即可。不需要 npm install 或打包步骤。

### 本地 HTML 文件

在 WordLens 的**详细信息**中开启**允许访问文件 URL**，然后刷新 HTML 文件。工具栏面板会显示该权限是否开启，并提供扩展详情入口。

更新时覆盖原扩展文件夹，在扩展管理页面点击**重新加载**，再刷新网页。不要删除或移动浏览器正在加载的文件夹。

## 使用

选中即查；点击空白、按 Esc 或滚动页面关闭浮窗。在面板中输入单词、短语或句子，Enter 查询，Shift + Enter 换行。“网页划词 / 划句”只控制自动浮窗，手动查询始终可用。

短语有词典音标时显示音标；句子提供翻译和英语朗读。朗读需要系统安装本地英语语音包，音标不会随口音偏好变化。

### 浏览器没有识别到本地英语语音

在 Windows 打开**设置 → 时间和语言 → 语音 → 管理语音 → 添加语音**，选择**英语（美国）**或**英语（英国）**，等待下载完成，再彻底退出并重新打开 Edge / Chrome。在插件面板点击**重新检查**与**测试发音**。浏览器仍在后台运行时，可从任务栏通知区域退出，或重启电脑。

已有 **Microsoft Zira Desktop** 不一定代表浏览器能使用英语：Chromium 在 Windows 优先读取现代 OneCore 语音目录，旧 SAPI 目录中的语音可能不会列出。只安装英语键盘或语音识别也不等于安装了英语文本转语音。参见[微软安装说明](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices)与[Chromium 语音实现](https://github.com/chromium/chromium/blob/main/content/browser/speech/tts_win.cc)。

1.1.2 会重试尚未初始化的语音列表，支持明确标记为本地的扩展语音引擎，并区分列表读取失败与没有英语语音。扩展不会自动改用在线语音服务。

## 网络与隐私

单词和已收录短语完全离线查询。联网翻译默认开启，可在面板关闭；未收录的短语和句子通过 [MyMemory](https://mymemory.translated.net/doc/spec.php) 翻译，**只发送选中或输入的文字**，不发送整页、网页地址、周围上下文或 Cookie。

MyMemory 有免费使用限额，网络不可用、超时或额度用尽时会明确提示。第三方服务的数据处理规则以其条款为准。扩展不保存查词历史，无跟踪或分析统计；少量翻译缓存只存在后台内存，关闭联网翻译会清除缓存并取消未完成请求。

## 兼容性与限制

支持 Chrome / Edge 114+ 的普通网页、本地 HTML 和允许内容脚本运行的 iframe。输入框和富文本编辑区域不会触发浮窗。浏览器设置页、扩展商店、内置 PDF 阅读器、扫描图片和 Canvas 文字不支持直接划词，可使用面板手动查询。

## 项目结构

- `extension/`：可直接加载的 Manifest V3 扩展，包含完整压缩词库。
- `tests/`：Node.js 核心、翻译与本地语音适配器测试。
- `scripts/package.py`：生成与 Releases 相同结构的安装 ZIP。
- `docs/images/`：功能示例截图。

开发验证（Node.js 20+）：

```sh
npm test
```

生成安装包（Python 3）：

```sh
python scripts/package.py
```

输出到 `dist/WordLens-1.1.2.zip`。

## 数据来源与授权

扩展源码采用 [MIT License](LICENSE)。英汉词库来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，上游授权完整保存在 [ECDICT-LICENSE.txt](extension/ECDICT-LICENSE.txt)。词库条目数量、格式与原始文件 SHA-256 见 [metadata.json](extension/data/metadata.json)。

词典按前两个字母拆分并 gzip 压缩，仅按需解压相关分片。
