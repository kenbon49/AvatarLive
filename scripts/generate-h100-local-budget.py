"""Build an indicative hardware budget for a fully local AvatarLive stack."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


OUTPUT = Path(__file__).resolve().parents[1] / "artifacts" / "AvatarLive-H100-local-deployment-budget-4TB-2026-09-16.xlsx"
DAY = date(2026, 9, 16)
NAVY = "193F42"
TEAL = "D9EDE8"
PALE = "F1F7F5"
ORANGE = "FFF1D8"
WHITE = "FFFFFF"
MONEY = '"¥"#,##0;[Red]("¥"#,##0)'

# These are planning allowances, not verified seller quotes or a promise of availability.
HARDWARE = [
    ("算力", "NVIDIA H100 PCIe 80GB", "单卡；确认 PCIe 80GB、来源、保修及被动散热风道；不是 SXM/H800/H20", 1, "张", 150000, 250000, "Wan S2V 与 Animate 排队运行；同时运行需另购第二张卡", "Wan2.2-S2V-14B、Wan2.2-Animate-14B；Qwen-Image-Edit/LiveAct 错峰"),
    ("算力", "NVIDIA RTX 5090 32GB", "双卡同机；机箱净空、辅助供电与 PCIe 槽位需核实", 1, "张", 20000, 28000, "MuseTalk + 本地问答/语音；需实测显存共同驻留", "MuseTalk 1.5、Qwen3 8B/14B INT4、CosyVoice 3/MeloTTS、FunASR/Whisper；图片编辑可错峰"),
    ("计算", "AMD Threadripper PRO 7975WX", "32 核 64 线程；亦可按兼容清单换同级 CPU", 1, "颗", 25000, 32000, "前后端、视频处理与 Wan CPU offload", "Wan 预处理/offload、MediaPipe + LaMa、Next.js/FastAPI/PostgreSQL/SRS"),
    ("计算", "WRX90 工作站主板", "双 PCIe x16 物理插槽、ECC RDIMM、足够槽距和可用 PCIe 通道", 1, "块", 8000, 12000, "注意 H100 的服务器级风道不由主板保证", "承载 H100 上的 Wan 双模型及 5090 上的 MuseTalk/Qwen3/语音模型"),
    ("计算", "DDR5 ECC RDIMM 256GB", "例如 8 x 32GB；与 WRX90 QVL 匹配", 1, "套", 8000, 12000, "本地 LLM、多模型切换及预处理缓冲", "Wan CPU offload、Qwen3、音视频预处理；数据库及业务服务"),
    ("存储", "NVMe SSD 4TB（唯一硬盘）", "企业级或高耐久；系统、数据库、容器、模型权重、素材、缓存和成片共用", 1, "块", 2000, 3500, "无独立备份盘；容量和写入耐久按实际权重、视频留存量复核", "存放 Wan S2V/Animate、MuseTalk、Qwen3、CosyVoice/MeloTTS、图片编辑等权重及业务数据"),
    ("散热", "服务器级风道机箱及散热", "采购/自装时核实 H100 被动散热、5090 净空、CPU 散热和噪声", 1, "套", 6000, 12000, "不能按普通敞开式塔式机箱估算", "保障 H100 的 Wan 模型、5090 的 MuseTalk/Qwen3/语音模型满载运行"),
    ("供电", "2000-2400W 电源及配线", "品牌电源；确认供电接口、电源冗余/热设计", 1, "套", 4000, 7000, "按双 GPU 同时满载验证", "为 H100 的 Wan 模型和 5090 的 MuseTalk/Qwen3/语音模型供电"),
    ("网络", "10GbE 网卡", "匹配机房交换网络；纯单机使用可暂不配置", 1, "张", 800, 1500, "模型权重/素材传输与内网业务、SRS 推流", "不运行模型；支持全部本地模型的文件传输与 SRS 推流"),
    ("网络", "10GbE 交换机/布线", "若已有 10GbE 网络，可在正式报价中减去", 1, "套", 1200, 2500, "包含相应线缆/模块的预算占位", "不运行模型；连接客户端与 Next.js/FastAPI/SRS 服务"),
]

MODELS = [
    ("数字人成片", "Wan2.2-S2V-14B", "H100 80GB", "480p/720p 音频驱动视频；排队生成", "需接入", "替代部分云端灵眸视频生成；不等同云形象与声线", "https://github.com/Wan-Video/Wan2.2#run-speech-to-video-generation"),
    ("动作迁移", "Wan2.2-Animate-14B", "H100 80GB", "人物参考图+动作视频；与 S2V 错峰", "需接入", "替代 HappyHorse/Seedance 的部分动作需求；需源视频预处理", "https://github.com/Wan-Video/Wan2.2#run-wan-animate"),
    ("实时直播", "MuseTalk 1.5 + Whisper/VAE/人脸解析", "RTX 5090", "已有本地渲染实现；正式主播底片须有授权", "本地代码已有；当前控制台仍需切换接口", "不能以 Wan 14B 替代低延迟直播", "https://github.com/TMElyralab/MuseTalk"),
    ("问答/脚本", "Qwen3 8B/14B INT4", "RTX 5090", "容量和并发按 P95 延迟压测", "需将现有 LiteLLM/GPT 路由改接本地", "替代云端问答/文案；不是原云模型的逐字复刻", "https://github.com/QwenLM/Qwen3"),
    ("配音/克隆", "CosyVoice 3 或 MeloTTS", "RTX 5090 / CPU", "声线需重新授权/建库；云端官方音色不能直接离线复制", "需替换 Azure 与云端音色接口", "同时供应 Wan 的输入音频和直播音频", "https://github.com/FunAudioLLM/CosyVoice"),
    ("语音识别", "FunASR/Whisper（可选）", "RTX 5090 / CPU", "真人接管/语音问答；可按需加载", "按场景接入", "不需要语音输入时可不常驻", "https://github.com/modelscope/FunASR"),
    ("形象图片编辑", "Qwen-Image-Edit（量化版）", "H100 错峰 / 5090 空闲时", "当前本机 ComfyUI 有相关权重，但项目业务 API 未接入", "需替换 Gemini/Nano Banana", "与 Wan 同卡时排队，不承诺并发常驻", "https://github.com/QwenLM/Qwen-Image"),
    ("图片抠图/修复", "MediaPipe + LaMa", "CPU / RTX 5090", "项目已有本地抠图及背景修复资产", "部分已有", "影像修复与模版制作，不占独立大卡", "https://github.com/advimman/lama"),
    ("兼容旧功能", "FlashHead Lite / LiveAct", "RTX 5090 / H100 错峰", "旧入口可保留；需单独迁移权重与运行环境", "可选保留", "LiveAct 同 Wan 不同时常驻 H100", "https://github.com/Soul-AILab/SoulX-LiveAct"),
    ("业务服务", "Next.js + FastAPI + PostgreSQL + SRS", "CPU/内存/4TB 单盘", "本机部署并配置内网访问和推流；外部备份另行安排", "现有代码可部署", "非 GPU 模型；需按环境部署", "https://github.com/ossrs/srs"),
]


def heading(sheet, title, subtitle, columns):
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=columns)
    cell = sheet.cell(1, 1, title)
    cell.fill = PatternFill("solid", fgColor=NAVY)
    cell.font = Font(name="Microsoft YaHei", size=16, color=WHITE, bold=True)
    cell.alignment = Alignment(vertical="center")
    sheet.row_dimensions[1].height = 38
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=columns)
    note = sheet.cell(2, 1, subtitle)
    note.font = Font(name="Microsoft YaHei", size=10, color="5D6C70")
    note.alignment = Alignment(vertical="center", wrap_text=True)
    sheet.row_dimensions[2].height = 42


def table_header(sheet, row, labels):
    for col, value in enumerate(labels, 1):
        cell = sheet.cell(row, col, value)
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.font = Font(name="Microsoft YaHei", color=WHITE, bold=True)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    sheet.row_dimensions[row].height = 30


def data_row(sheet, row, values, shaded=False):
    for col, value in enumerate(values, 1):
        cell = sheet.cell(row, col, value)
        cell.fill = PatternFill("solid", fgColor=PALE if shaded else WHITE)
        cell.font = Font(name="Microsoft YaHei", color=NAVY, size=10)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = Border(bottom=Side(style="hair", color="DDE7E4"))
    sheet.row_dimensions[row].height = 43


def widths(sheet, widths_by_column):
    for col, width in enumerate(widths_by_column, 1):
        sheet.column_dimensions[get_column_letter(col)].width = width


def build():
    workbook = Workbook()
    summary = workbook.active
    summary.title = "预算总览"
    detail = workbook.create_sheet("硬件明细")
    models = workbook.create_sheet("本地模型与替代")
    compare = workbook.create_sheet("扩容方案")
    assumptions = workbook.create_sheet("口径与验收")

    heading(detail, "H100 本地部署 | 硬件及费用明细", "人民币预算区间；仅一块 4TB 硬盘，不含 UPS、独立备份设备及装配验收服务。数量/单价可修改，合计由公式更新。", 12)
    table_header(detail, 4, ["序号", "类别", "设备", "规格及验收要求", "数量", "单位", "单价低", "单价高", "小计低", "小计高", "用途与风险", "对应模型/服务"])
    for idx, item in enumerate(HARDWARE, 1):
        row = idx + 4
        group, name, spec, count, unit, low, high, reason, deployed = item
        data_row(detail, row, (idx, group, name, spec, count, unit, low, high, f"=E{row}*G{row}", f"=E{row}*H{row}", reason, deployed), idx % 2 == 0)
        for col in (7, 8, 9, 10):
            detail.cell(row, col).number_format = MONEY
    total_row = len(HARDWARE) + 5
    detail.cell(total_row, 3, "整机预算合计")
    detail.cell(total_row, 9, f"=SUM(I5:I{total_row - 1})")
    detail.cell(total_row, 10, f"=SUM(J5:J{total_row - 1})")
    for col in range(1, 13):
        cell = detail.cell(total_row, col)
        cell.fill = PatternFill("solid", fgColor=TEAL)
        cell.font = Font(name="Microsoft YaHei", color=NAVY, bold=True)
    for col in (9, 10):
        detail.cell(total_row, col).number_format = MONEY
    detail.row_dimensions[total_row].height = 34
    widths(detail, [8, 11, 29, 62, 9, 9, 15, 15, 16, 16, 59, 80])
    detail.freeze_panes = "E5"
    detail.auto_filter.ref = f"A4:L{total_row - 1}"

    min_total = sum(item[3] * item[5] for item in HARDWARE)
    max_total = sum(item[3] * item[6] for item in HARDWARE)
    heading(summary, "AvatarLive | H100 全本地化部署预算", f"制定日期：{DAY.isoformat()}  |  一路 MuseTalk 实时直播 + 后台 Wan 排队生成  |  预算不等于正式采购报价", 5)
    widths(summary, [26, 34, 36, 36, 86])
    table_header(summary, 4, ["方案", "预算低", "预算高", "部署形态", "范围说明"])
    data_row(summary, 5, ("推荐整机（H100 + RTX 5090）", f"='硬件明细'!I{total_row}", f"='硬件明细'!J{total_row}", "单机双卡、256GB ECC、仅一块 4TB NVMe", "不含 UPS、独立备份和装配验收费；H100 需服务器级强制风道；图片编辑与 Wan 错峰"))
    for col in (2, 3):
        summary.cell(5, col).number_format = MONEY
    data_row(summary, 7, ("固定数量静态预览", min_total, max_total, "基于当前明细单价", "只供不支持公式预览的软件阅读；正式调整价格后以第 5 行公式为准"), True)
    for col in (2, 3):
        summary.cell(7, col).number_format = MONEY
    summary.cell(9, 1, "关键边界")
    for row, label, value in [
        (10, "Wan 的用途", "S2V 负责音频驱动高质量视频，Animate 负责参考动作迁移；两模型共享 H100，默认串行，不承诺实时直播。"),
        (11, "实时直播", "MuseTalk 1.5 放在 5090；本地 Qwen + TTS 共同驻留的吞吐须现场压测。"),
        (12, "云能力替换", "云端灵眸数字人、Azure 音色、Gemini 图片编辑及远程 LLM 不会因采购硬件自动转为本地；需要接口开发和授权素材。"),
        (13, "采购口径", "设备单价为立项估值，无可核验的实时经销商正式报价；税率、质保年限、交期、运维及软件研发需向供应商确认。"),
        (14, "自行验收", "虽已删除装配及满载验收服务费，仍须核验 PCIe H100 型号/质保、被动散热风道，以及双卡满载与 Wan 样片。"),
        (15, "单盘风险", "仅一块 4TB 盘；系统、模型和业务数据均在同盘，硬盘故障会造成数据损失；异机/异地备份须另行安排。"),
        (16, "断电风险", "UPS 已从报价删除；停电或电压异常时任务会中断，未落盘数据可能丢失，无法保证连续推流。"),
    ]:
        summary.cell(row, 1, label)
        summary.merge_cells(start_row=row, start_column=2, end_row=row, end_column=5)
        cell = summary.cell(row, 2, value)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        summary.row_dimensions[row].height = 43
        summary.cell(row, 1).fill = PatternFill("solid", fgColor=TEAL)

    heading(models, "模型部署位置与现有项目替代关系", "“本地部署”表示推理发生在本机；OSS 仅用于本报价文件分享。当前云端能力并非已完成本地替代。", 7)
    table_header(models, 4, ["业务功能", "拟用模型/服务", "分配设备", "资源与调度", "项目状态", "替代范围和限制", "依据"])
    for idx, item in enumerate(MODELS, 5):
        data_row(models, idx, item, idx % 2 == 0)
        link = models.cell(idx, 7)
        link.hyperlink = item[6]
        link.style = "Hyperlink"
    widths(models, [18, 34, 27, 55, 45, 73, 75])
    models.freeze_panes = "C5"
    models.auto_filter.ref = f"A4:G{4 + len(MODELS)}"

    heading(compare, "配置变体 | 均以 H100 为主卡", "配套件与推荐方案完全一致，仅按第二张或新增的 H100 变更估算；不是正式并发保证。", 6)
    table_header(compare, 4, ["方案", "显卡组合", "低预算", "高预算", "适用场景", "限制"])
    data_row(compare, 5, ("节省显卡成本", "H100 80GB + 二手 3090 24GB", min_total - 20000 + 8000, max_total - 28000 + 13000, "一路实时直播 + Wan 串行", "3090 上 LLM/TTS/MuseTalk 并发需缩模型或错峰；二手卡风险"))
    data_row(compare, 6, ("推荐完整方案", "H100 80GB + RTX 5090 32GB", f"='硬件明细'!I{total_row}", f"='硬件明细'!J{total_row}", "一路直播 + Wan 后台任务", "Wan 两个 14B 模型按任务切换"), True)
    data_row(compare, 7, ("Wan 双任务扩容预留", "2 x H100 PCIe 80GB + RTX 5090 32GB", min_total + 150000 + 3000, max_total + 250000 + 8000, "两路 Wan 任务独立 GPU", "增加风道/供电预算；须由集成商确认三卡插槽、机箱和散热"))
    for row in (5, 6, 7):
        for col in (3, 4):
            compare.cell(row, col).number_format = MONEY
    widths(compare, [26, 49, 18, 18, 50, 90])

    heading(assumptions, "预算口径、出处与验收清单", "技术来源证明功能和显存门槛，不构成设备价格证据。价格均为暂估，采购前需询价。", 4)
    table_header(assumptions, 4, ["类别", "事项", "说明", "链接/验收材料"])
    notes = [
        ("价格", "价格口径", "2026-09-16 项目立项预算；未取得可核验实时厂商正式报价；币种人民币，不预设是否含税。", "采购前索取至少两家集成商含税报价、交期和质保"),
        ("硬件", "H100 型号", "必须是 PCIe 80GB；SXM 需 HGX 服务器，不能插 WRX90。", "https://www.nvidia.com/en-us/data-center/h100/"),
        ("模型", "Wan S2V 显存", "官方 README 单卡至少 80GB，并提供 offload 命令；这不保证所有视频长度都不 OOM。", "https://github.com/Wan-Video/Wan2.2#run-speech-to-video-generation"),
        ("模型", "Wan Animate 预处理", "需视频预处理和权重；采购前在 H100 上用目标时长、分辨率实测显存和耗时。", "https://github.com/Wan-Video/Wan2.2#run-wan-animate"),
        ("项目", "MuseTalk 性能记录", "项目旧环境 3090 batch8 约 45 FPS、PyTorch reserved 7.10GiB，不等于总显存峰值或 5090 并发指标。", "AvatarLive/docs/musetalk-action-avatar-implementation.md"),
        ("项目", "当前云端依赖", "阿里云灵眸、Azure TTS、LiteLLM/GPT、Gemini、HappyHorse/Seedance 等需要逐项替换接口。", "AvatarLive/.env.example"),
        ("项目", "范围排除", "未包含模型适配研发、演员肖像/音色授权、专线公网、机房租金、OSS 流量、软件商业许可。", "项目合同单独列项"),
        ("测试", "H100 验收", "采购合同明确真实型号、来源、发票、保修、散热风道；Wan 双模型各生成 720p 目标片段。", "样片、显存峰值、耗时、温度与稳定性报告"),
        ("测试", "自行整机验收", "未购买装配验收服务；自行检查双 GPU 散热/供电及持续满载、Wan 双模型生成、前后端/SRS 推流、LLM+TTS+MuseTalk 共驻留。", "建议记录 30 分钟以上运行、显存/温度和故障恢复"),
        ("运维", "UPS 用途与删项", "UPS 提供短时断电缓冲以便安全停机，不负责长时供电；本预算已删除，突发停电时任务/数据和直播会受影响。", "需要业务连续性时再单独采购并按实际功率选型"),
        ("运维", "装配验收用途与删项", "原为组装、双卡风道/CUDA 调试、模型样片和持续满载测试的人工服务；已删除其费用，不代表可以跳过验收。", "采购后自行执行上述测试或另行委托"),
        ("运维", "单盘及备份", "本报价仅含一块 4TB NVMe，无独立备份设备；请自行安排异机/异地备份、测试恢复及设置素材保留周期。", "本预算不含外部备份服务及容量费用"),
        ("运维", "电费估算", "假定平均 1.2-1.6kW、全天满载、0.8 元/kWh，约 691-922 元/月；实际负载通常更低。", "计量/峰谷电价按实际机房复核"),
    ]
    for idx, note in enumerate(notes, 5):
        data_row(assumptions, idx, note, idx % 2 == 0)
        if isinstance(note[3], str) and note[3].startswith("https://"):
            assumptions.cell(idx, 4).hyperlink = note[3]
            assumptions.cell(idx, 4).style = "Hyperlink"
    widths(assumptions, [15, 26, 100, 90])
    assumptions.freeze_panes = "B5"

    for sheet in workbook:
        sheet.sheet_view.showGridLines = False
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.print_options.horizontalCentered = True
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(OUTPUT)
    print(f"{OUTPUT}\nrows={len(HARDWARE)} min_cny={min_total} max_cny={max_total}")


if __name__ == "__main__":
    build()
