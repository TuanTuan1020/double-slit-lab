# 波间 · 双缝干涉实验室

一个可以动手探索的双缝干涉静态网站。纯 HTML、CSS、JavaScript，无构建步骤、无第三方运行依赖。

**在线体验：[https://tuantuan1020.github.io/double-slit-lab/](https://tuantuan1020.github.io/double-slit-lab/)**

## 交互内容

- 主传播区域、探测屏与理论光强曲线共享远场振幅模型；缝口附近单独标明为示意。
- 调节波长、双缝间距、屏幕距离、缝宽和初始相位差。
- 双缝、单缝、理想完整路径探测三种模式。
- 单粒子随机落点积累；保留装置示意，发射后延时落屏。支持暂停、单发、批量发射和速率调整，切换视图保留在途事件。
- 点击屏幕或拖动曲线测量局部光强与几何程差；曲线支持方向键。
- 实时程差、相位与两路振幅叠加示意；可保存基准曲线，持续对照参数变化。
- 当前理论数据与对照数据可导出 CSV（包含双方参数），实验台支持全屏。
- 原理图解、三组探索预设和模型说明。
- 响应式布局、手机参数抽屉、触摸测量、键盘焦点提示、减少动态效果偏好支持。

## 本地运行

在项目目录启动一个静态服务器：

```sh
python3 -m http.server 4173
```

打开 `http://localhost:4173/`。因为使用 ES modules，请通过 HTTP 访问，避免直接双击 HTML。

## GitHub Pages

仓库 Settings → Pages → Deploy from a branch → `main` / `(root)` → Save。
所有资源均使用相对路径，支持仓库级 Pages 子路径。

## 模型

固定使用夫琅禾费远场、小角近似模型：

```text
I/Iref = sinc²(πay / (λL)) · cos²(πdy / (λL) + φ/2)
Δy ≈ λL / d
sinc(u) = sin(u) / u, sinc(0) = 1
```

波长输入单位 nm，缝距与缝宽 mm，屏幕距离 m，屏幕位置 mm，相位差为度。
默认参数下，细条纹间距为 3.12 mm，首个衍射包络零点距中央 15.60 mm。

单缝和理想完整路径探测模式去掉干涉项，显示分别归一化的衍射包络；不比较不同模式的总透射功率。单缝模式不显示双缝程差。完全路径可区分表示与装置发生相互作用并留下路径信息，不取决于是否有人阅读结果。

粒子落点按可见范围 ±15 mm 内的理论强度分布独立抽样，纵向坐标均匀随机；不代表粒子穿缝后的确定轨迹。直方图按样本峰值归一化，仅用于形状比较。每轮最多记录 40,000 个落点；改变参数会清空积累。传播图采用同一远场模型，深度 z/L 对应有效屏幕坐标 y/(z/L)；它不是实际近场求解。缝口附近的短波前、慢速载波、发射到落屏的0.5秒演示间隔、颜色和装置比例用于示意。极端参数组合的真实近场细节不在模型内。

## 文件

- `index.html`：页面内容、控件与原理说明
- `style.css`：响应式视觉设计
- `app.js`：Canvas 绘制与交互状态
- `physics.js`：独立物理模型和随机采样
- `favicon.svg`：站点标识
- `.nojekyll`：直接作为静态资源托管

## 参考

- [OpenStax：杨氏双缝实验](https://openstax.org/books/university-physics-volume-3/pages/3-3-youngs-double-slit-experiment)
- [OpenStax：单缝衍射强度](https://openstax.org/books/university-physics-volume-3/pages/4-2-intensity-in-single-slit-diffraction)
- [OpenStax：双缝衍射](https://openstax.org/books/university-physics-volume-3/pages/4-3-double-slit-diffraction)
- [Caltech：费曼物理学讲义 III.1](https://www.feynmanlectures.caltech.edu/III_01.html)
