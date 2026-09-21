import Link from 'next/link';
import { SupportNav } from '@/components/support-nav';
import styles from '@/app/support.module.css';

const steps = [
  {
    title: '1. 新建直播间并选择数字人主播',
    image: '/assets/manual/01-create-room.png',
    alt: '最新的新建直播间界面，包含数字人选择、直播间名称和创建并进入按钮',
    actions: [
      <>进入<Link href="/live">数字人直播</Link>，点击“新建直播间”。</>,
      <>在形象列表中点击一位主播；右上角出现勾选，底部“已选数字人”会同步更新。</>,
      <>填写容易识别的直播间名称，例如“秋季新品直播间”，再点击“创建并进入”。</>,
    ],
    done: '页面进入直播控制台，并且顶部显示刚填写的直播间名称。',
  },
  {
    title: '2. 输入简易脚本，或上传商品图片后扩写',
    image: '/assets/manual/02-script-and-image.png',
    alt: '最新的话术编辑界面，包含扩写按钮、素材上传、脚本文本和商品图片缩略图',
    actions: [
      <>在左侧选择“脚本”，点击“写片段”，直接输入一句简短介绍，例如商品名称、特点和适用人群。</>,
      <>如果没有现成文案，点击“扩写”旁边的上传图标，选择商品图片；图片缩略图出现后，直接点击“扩写”。也可以同时输入一句要求再扩写。</>,
      <>等待生成结束，通读内容并修改价格、功效、库存等容易出错的信息。需要缩短或调整表达时，可继续使用“精简”或“润色”。</>,
    ],
    done: '左侧文本框中已经是一段可以直接口播的完整话术。',
    note: '每次扩写、精简或润色都会调用 LLM，并按管理员设置的单次价格扣除额度。',
  },
  {
    title: '3. 选择声音、试听并加入分镜',
    image: '/assets/manual/03-voice-preview.png',
    alt: '最新的主播声音选择界面，包含公共音色试听、语速、语调和应用按钮',
    actions: [
      <>点击脚本框下方的主播声音名称，打开“主播声音”。</>,
      <>点击音色卡片左侧的播放图标试听；选中合适音色后调整语速、语调，点击“应用”。“应用至全部”会同时修改已有分镜。</>,
      <>返回脚本页，点击“试听脚本”检查整段口播。确认无误后，点击字数右侧的“+”加入分镜。</>,
    ],
    done: '页面底部出现新的分镜缩略图，并显示“待合成”。',
  },
  {
    title: '4. 装饰直播间并检查画面',
    image: '/assets/manual/04-decorated-room.png',
    alt: '最新的直播间装修界面，包含模板、组件、图片、文字和中央直播预览',
    actions: [
      <>点击左侧“装修”，先在“模板”中选择接近目标风格的直播模板。</>,
      <>根据需要切换“组件”“图片”“文字”，添加直播标题、优惠信息、商品图或自定义文字。</>,
      <>在中央预览中检查主播是否被遮挡；选中画面元素后可移动、缩放或旋转，右侧图层列表可调整前后顺序。</>,
    ],
    done: '中央预览中的主播、背景、标题和商品信息都清楚可见，没有互相遮挡。',
  },
  {
    title: '5. 保存直播间并合成分镜',
    image: '/assets/manual/05-save-and-synthesize.png',
    alt: '最新的直播控制台，顶部显示保存直播间，底部显示分镜和合成分镜按钮',
    actions: [
      <>点击右上角“保存直播间”，等待直播间名称下方显示“已自动保存”，再进行合成。</>,
      <>在底部分镜条中点击要使用的分镜，确认它处于蓝色选中状态。</>,
      <>点击右下角“合成分镜”，等待“待合成”变为“成片”。合成完成后点击分镜上的播放按钮，检查口型、声音和画面。</>,
      <>有多条分镜时逐条检查并合成；修改话术、主播或音色后，原成片会提示需要重新合成。</>,
    ],
    done: '准备开播的每条分镜都显示“成片”，并且预览播放正常。',
    note: '每条分镜合成会按管理员设置的单条价格扣除额度；额度不足时需先联系管理员分配额度。',
  },
  {
    title: '6. 完成开播编排并开始直播',
    image: '/assets/manual/06-start-live.png',
    alt: '最新的开播编排界面，包含窗口采集、画面比例、开播检查和节目输出按钮',
    actions: [
      <>点击右上角“开播编排”。第一次使用建议选择“窗口采集（推荐）”和“普通窗口”。</>,
      <>按平台要求选择“9:16 竖屏手机窗口”或“16:9 横屏 PC 窗口”，确认“开播前检查”全部通过。</>,
      <>点击“打开节目输出窗口”，再到抖音、快手、视频号等平台的官方直播伴侣中添加窗口采集，并同时采集系统声音。</>,
      <>在官方直播伴侣中确认画面和声音后点击开播。直播过程中保持控制台和节目输出窗口打开，可在控制台切换、暂停或跳过分镜。</>,
    ],
    done: '官方直播伴侣中能看到完整节目画面、听到分镜声音，并显示正在直播。',
    note: '已有合法 RTMP 地址和推流密钥时，也可以切换“手工 RTMP”；密钥应只保存在系统的加密配置中。',
  },
];

export default function HelpPage() {
  return <main className={styles.page}><SupportNav title="操作手册" />
    <section className={styles.manualIntro}>
      <h2>第一次创建数字人直播</h2>
      <p>按下面顺序操作，即可从空白直播间完成主播选择、话术生成、试听、装修、分镜合成和开播。所有截图均来自当前版本。</p>
      <div className={styles.manualPath} aria-label="操作流程">创建直播间 <span>→</span> 写话术 <span>→</span> 试听 <span>→</span> 装修 <span>→</span> 保存 <span>→</span> 合成 <span>→</span> 开播</div>
      <h3>开始前准备</h3>
      <ul>
        <li>使用已经通过管理员审核的账号登录。</li>
        <li>确认账号有足够额度，话术处理和数字人分镜合成都会扣除额度。</li>
        <li>准备一句商品介绍或一张清晰商品图片；正式开播还需安装对应平台的官方直播伴侣，或准备合法的 RTMP 信息。</li>
      </ul>
    </section>
    {steps.map((step) => <section className={styles.manualSection} key={step.title}>
      <h2>{step.title}</h2>
      <figure className={styles.manualFigure}><img src={step.image} alt={step.alt} /><figcaption>{step.alt}</figcaption></figure>
      <ol>{step.actions.map((action, index) => <li key={index}>{action}</li>)}</ol>
      <p className={styles.manualDone}><strong>完成标志</strong><span>{step.done}</span></p>
      {step.note && <p className={styles.manualNote}>{step.note}</p>}
    </section>)}
  </main>;
}
