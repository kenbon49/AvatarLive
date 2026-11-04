const PREGENERATED_LIVE_SCRIPT_VIDEOS: Readonly<Record<string, string>> = {
  '有时候不是想喝很重的味道，就是想在家里、办公室安静泡一杯，闻着舒服一点。这款茉莉花茶做的是茉莉银针，净含量125g，罐装设计，拿在手里就是很清爽的感觉。想找花茶的人，可以先看看这款。':
    '/avatar-video-api/assets/custom-happyhorse-preview/91bab959-4a1d-46cc-93e1-b70aaab66e14/talk.mp4',
  '它的品牌是清雷，产地是广西横州，属于国产茶。品种写得很明确，是茉莉银针。配料也比较直接，就是烘青绿茶和横县茉莉鲜花。信息清楚，选的时候心里会更有数，平时自己喝，或者放在茶柜里慢慢喝都很合适。':
    '/avatar-video-api/assets/custom-happyhorse-preview/79e5a240-dec8-4e81-aa54-ff959d4846bf/talk.mp4',
  '它是浅蓝绿色的罐身，上面有白色花朵图案，正面大字写着花茶和茉莉，整体看着很干净，很柔和。罐装本身也比较利落，放在桌面上就是这种清清爽爽的视觉感受。你如果平时喜欢简洁一点的茶罐风格，这款外观会比较顺眼。':
    '/avatar-video-api/assets/custom-happyhorse-preview/f3dd3403-ea67-41bf-b3b8-7281b66bfe3e/talk.mp4',
  '这一罐是125g，保质期18个月，贮存条件写的是阴凉干燥处。这个信息很实在，你可以按自己的喝茶频率来选，开封后也记得放在合适的环境里，日常自己冲泡、偶尔招待朋友，都比较方便安排。':
    '/avatar-video-api/assets/custom-happyhorse-preview/f64711fa-9968-4c28-afc5-573f5adea866/talk.mp4',
  '如果你现在想找一款信息清楚、产地和品种都标注明白的茉莉花茶，这款可以放进你的备选里。茉莉银针、125g罐装、清爽花叶风格，特点都比较直观。感兴趣的话就点开商品卡看看详情，按自己的喝茶习惯来选就行。':
    '/avatar-video-api/assets/custom-happyhorse-preview/9e01922a-a934-456c-86bc-fd699c359c6e/talk.mp4',
};

export function getPregeneratedLiveVideo(text: string): string | undefined {
  return PREGENERATED_LIVE_SCRIPT_VIDEOS[text.trim()];
}
