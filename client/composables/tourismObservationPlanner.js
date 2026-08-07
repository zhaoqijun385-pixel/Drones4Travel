const EARTH_RADIUS_M = 6_371_008.8;
const DEFAULT_CRUISE_SPEED_MS = 42;
const DEFAULT_CLIMB_SPEED_MS = 8;
const DEFAULT_LANDING_SPEED_MS = 15;
const OBSERVE_HOLD_MS = 1600;
const GROUND_ALT = 0.12;

export const TOURISM_GAZETTEER = Object.freeze([
  { id: 'great-wall-mutianyu', name: '慕田峪长城', aliases: ['Mutianyu', 'Great Wall', '长城', '慕田峪'], lat: 40.4319, lon: 116.5704 },
  { id: 'forbidden-city', name: '故宫博物院', aliases: ['Forbidden City', 'Palace Museum', '故宫', '紫禁城'], lat: 39.9163, lon: 116.3972 },
  { id: 'temple-of-heaven', name: '天坛公园', aliases: ['Temple of Heaven', '天坛'], lat: 39.8822, lon: 116.4066 },
  { id: 'summer-palace', name: '颐和园', aliases: ['Summer Palace'], lat: 39.9999, lon: 116.2755 },
  { id: 'the-bund', name: '上海外滩', aliases: ['The Bund', 'Shanghai', '外滩'], lat: 31.2400, lon: 121.4903 },
  { id: 'west-lake', name: '杭州西湖', aliases: ['West Lake', 'Hangzhou', '西湖'], lat: 30.2470, lon: 120.1495 },
  { id: 'mount-huangshan', name: '黄山风景区', aliases: ['Mount Huangshan', 'Yellow Mountain', '黄山'], lat: 30.1239, lon: 118.1649 },
  { id: 'li-river', name: '桂林漓江', aliases: ['Li River', 'Guilin', '漓江', '桂林'], lat: 25.2742, lon: 110.2900 },
  { id: 'jiuzhaigou', name: '九寨沟', aliases: ['Jiuzhaigou'], lat: 33.2605, lon: 103.9183 },
  { id: 'zhangjiajie', name: '张家界国家森林公园', aliases: ['Zhangjiajie', 'Avatar Mountains', '张家界'], lat: 29.3167, lon: 110.4333 },
  { id: 'potala-palace', name: '布达拉宫', aliases: ['Potala Palace', 'Lhasa', '布达拉宫', '拉萨'], lat: 29.6572, lon: 91.1172 },
  { id: 'terracotta-army', name: '秦始皇兵马俑', aliases: ['Terracotta Army', "Xi'an", '兵马俑', '西安'], lat: 34.3841, lon: 109.2785 },
  { id: 'humble-administrator', name: '苏州拙政园', aliases: ["Humble Administrator's Garden", 'Suzhou', '拙政园', '苏州'], lat: 31.3244, lon: 120.6258 },
  { id: 'taipei-101', name: '台北101', aliases: ['Taipei 101'], lat: 25.0330, lon: 121.5645 },
  { id: 'victoria-peak', name: '香港太平山顶', aliases: ['Victoria Peak', 'Hong Kong', '太平山', '香港'], lat: 22.2752, lon: 114.1453 },
  { id: 'macau-tower', name: '澳门旅游塔', aliases: ['Macau Tower'], lat: 22.1776, lon: 113.5370 },
  { id: 'eiffel-tower', name: '巴黎埃菲尔铁塔', aliases: ['Eiffel Tower', 'Paris', '埃菲尔铁塔', '巴黎'], lat: 48.8584, lon: 2.2945 },
  { id: 'colosseum', name: '罗马斗兽场', aliases: ['Colosseum', 'Rome', '斗兽场', '罗马'], lat: 41.8902, lon: 12.4922 },
  { id: 'santorini', name: '圣托里尼', aliases: ['Santorini'], lat: 36.3932, lon: 25.4615 },
  { id: 'mount-fuji', name: '富士山', aliases: ['Mount Fuji', 'Fuji'], lat: 35.3606, lon: 138.7274 },
  { id: 'fushimi-inari', name: '京都伏见稻荷大社', aliases: ['Fushimi Inari', 'Kyoto', '伏见稻荷', '京都'], lat: 34.9671, lon: 135.7727 },
  { id: 'gardens-by-the-bay', name: '新加坡滨海湾花园', aliases: ['Gardens by the Bay', 'Singapore', '滨海湾'], lat: 1.2816, lon: 103.8636 },
  { id: 'sydney-opera-house', name: '悉尼歌剧院', aliases: ['Sydney Opera House', 'Sydney', '歌剧院'], lat: -33.8568, lon: 151.2153 },
  { id: 'golden-gate-bridge', name: '旧金山金门大桥', aliases: ['Golden Gate Bridge', 'San Francisco', '金门大桥'], lat: 37.8199, lon: -122.4783 },
  { id: 'grand-canyon', name: '大峡谷国家公园', aliases: ['Grand Canyon', '大峡谷'], lat: 36.1069, lon: -112.1129 },
  { id: 'machu-picchu', name: '马丘比丘', aliases: ['Machu Picchu'], lat: -13.1631, lon: -72.5450 },
  { id: 'angkor-wat', name: '吴哥窟', aliases: ['Angkor Wat', 'Siem Reap'], lat: 13.4125, lon: 103.8670 },
  { id: 'burj-khalifa', name: '迪拜哈利法塔', aliases: ['Burj Khalifa', 'Dubai', '哈利法塔'], lat: 25.1972, lon: 55.2744 },
  { id: 'taj-mahal', name: '泰姬陵', aliases: ['Taj Mahal'], lat: 27.1751, lon: 78.0421 },
  { id: 'pyramids-giza', name: '吉萨金字塔', aliases: ['Pyramids of Giza', 'Egypt', '金字塔'], lat: 29.9792, lon: 31.1342 },
  { id: 'tokyo-tower', name: '东京塔', aliases: ['Tokyo Tower', 'Tokyo'], lat: 35.6586, lon: 139.7454 },
  // 中国（华北/东北）
  { id: 'badaling-great-wall', name: '八达岭长城', aliases: ['Badaling', '八达岭'], lat: 40.3593, lon: 116.0198 },
  { id: 'beihai-park', name: '北京北海公园', aliases: ['Beihai Park', '北海'], lat: 39.9254, lon: 116.3905 },
  { id: 'jingshan-park', name: '北京景山公园', aliases: ['Jingshan Park', '景山'], lat: 39.9250, lon: 116.3964 },
  { id: 'shichahai', name: '北京什刹海', aliases: ['Shichahai', '什刹海', '后海'], lat: 39.9400, lon: 116.3830 },
  { id: 'nanluoguxiang', name: '北京南锣鼓巷', aliases: ['Nanluoguxiang', '南锣鼓巷'], lat: 39.9367, lon: 116.4020 },
  { id: 'zhongshan-park-beijing', name: '北京中山公园', aliases: ['Zhongshan Park Beijing'], lat: 39.9088, lon: 116.3910 },
  { id: 'mukden-palace', name: '沈阳故宫', aliases: ['Mukden Palace', '沈阳故宫'], lat: 41.7961, lon: 123.4497 },
  { id: 'changbai-mountain', name: '长白山天池', aliases: ['Changbai Mountain', '长白山'], lat: 42.0104, lon: 128.0553 },
  { id: 'saint-sofia-harbin', name: '哈尔滨圣索菲亚大教堂', aliases: ['Saint Sophia Cathedral', '圣索菲亚', '哈尔滨'], lat: 45.7729, lon: 126.6218 },
  { id: 'mohe-north-village', name: '漠河北极村', aliases: ['Mohe', '北极村'], lat: 53.4846, lon: 122.3526 },
  { id: 'hulunbuir-grassland', name: '呼伦贝尔大草原', aliases: ['Hulunbuir', '呼伦贝尔'], lat: 49.2116, lon: 119.7730 },
  { id: 'zhanqiao-pier', name: '青岛栈桥', aliases: ['Zhanqiao Pier', '青岛'], lat: 36.0588, lon: 120.3172 },
  { id: 'laoshan-mountain', name: '青岛崂山', aliases: ['Laoshan Mountain', '崂山'], lat: 36.1960, lon: 120.6535 },
  { id: 'mount-tai', name: '泰山', aliases: ['Mount Tai', '东岳泰山'], lat: 36.2558, lon: 117.1011 },
  { id: 'qufu-confucius', name: '曲阜三孔', aliases: ['Qufu Confucius Temple', '三孔', '曲阜'], lat: 35.5995, lon: 116.9857 },
  { id: 'yungang-grottoes', name: '大同云冈石窟', aliases: ['Yungang Grottoes', '云冈石窟'], lat: 40.1112, lon: 113.1256 },
  { id: 'hanging-temple', name: '大同悬空寺', aliases: ['Hanging Temple', '悬空寺'], lat: 39.6647, lon: 113.7078 },
  { id: 'wutai-mountain', name: '五台山', aliases: ['Mount Wutai', '五台山'], lat: 39.0058, lon: 113.5733 },
  { id: 'pingyao-old-town', name: '平遥古城', aliases: ['Pingyao', '平遥'], lat: 37.1959, lon: 112.1668 },
  { id: 'hukou-waterfall', name: '壶口瀑布', aliases: ['Hukou Waterfall', '壶口'], lat: 36.1488, lon: 110.4472 },
  { id: 'ejina-populus', name: '额济纳胡杨林', aliases: ['Ejina Populus', '胡杨林'], lat: 41.9564, lon: 101.0634 },
  { id: 'western-xia-tombs', name: '银川西夏王陵', aliases: ['Western Xia Tombs', '西夏王陵'], lat: 38.4350, lon: 105.9900 },
  { id: 'shapotou', name: '中卫沙坡头', aliases: ['Shapotou', '沙坡头'], lat: 37.4650, lon: 105.0000 },
  // 中国（华东/华中/华南）
  { id: 'oriental-pearl-tower', name: '上海东方明珠', aliases: ['Oriental Pearl Tower', '东方明珠'], lat: 31.2397, lon: 121.4998 },
  { id: 'yu-garden', name: '上海豫园', aliases: ['Yu Garden', '豫园'], lat: 31.2278, lon: 121.4930 },
  { id: 'disneyland-shanghai', name: '上海迪士尼乐园', aliases: ['Shanghai Disneyland', '迪士尼'], lat: 31.1434, lon: 121.6560 },
  { id: 'zhujiajiao', name: '上海朱家角', aliases: ['Zhujiajiao', '朱家角'], lat: 31.1130, lon: 121.0550 },
  { id: 'lingering-garden', name: '苏州留园', aliases: ['Lingering Garden', '留园'], lat: 31.3169, lon: 120.6070 },
  { id: 'zhouzhuang', name: '周庄古镇', aliases: ['Zhouzhuang', '周庄'], lat: 31.1145, lon: 120.8450 },
  { id: 'tongli', name: '同里古镇', aliases: ['Tongli', '同里'], lat: 31.1519, lon: 120.7230 },
  { id: 'wuzhen', name: '乌镇', aliases: ['Wuzhen', '乌镇'], lat: 30.7436, lon: 120.4866 },
  { id: 'xitang', name: '西塘古镇', aliases: ['Xitang', '西塘'], lat: 30.9415, lon: 120.8890 },
  { id: 'yuan-tou-zhu', name: '无锡太湖鼋头渚', aliases: ['Yuantouzhu', '鼋头渚'], lat: 31.5175, lon: 120.2300 },
  { id: 'lingshan-grand-buddha', name: '无锡灵山大佛', aliases: ['Lingshan Grand Buddha', '灵山大佛'], lat: 31.4540, lon: 120.0870 },
  { id: 'sun-yat-sen-mausoleum', name: '南京中山陵', aliases: ['Sun Yat-sen Mausoleum', '中山陵'], lat: 32.0630, lon: 118.8490 },
  { id: 'confucius-temple-nanjing', name: '南京夫子庙', aliases: ['Confucius Temple Nanjing', '夫子庙'], lat: 32.0212, lon: 118.7866 },
  { id: 'slender-west-lake', name: '扬州瘦西湖', aliases: ['Slender West Lake', '瘦西湖'], lat: 32.4080, lon: 119.4230 },
  { id: 'qiandao-lake', name: '杭州千岛湖', aliases: ['Qiandao Lake', '千岛湖'], lat: 29.6028, lon: 119.0100 },
  { id: 'lingyin-temple', name: '杭州灵隐寺', aliases: ['Lingyin Temple', '灵隐寺'], lat: 30.2413, lon: 120.1030 },
  { id: 'hongcun-village', name: '黄山宏村', aliases: ['Hongcun', '宏村'], lat: 29.9943, lon: 117.9967 },
  { id: 'xidi-village', name: '黄山西递', aliases: ['Xidi', '西递'], lat: 29.9800, lon: 118.0000 },
  { id: 'huangling', name: '婺源篁岭', aliases: ['Huangling', '篁岭', '婺源'], lat: 29.3333, lon: 117.9500 },
  { id: 'tengwang-pavilion', name: '南昌滕王阁', aliases: ['Tengwang Pavilion', '滕王阁'], lat: 28.6863, lon: 115.8870 },
  { id: 'wuyi-mountain', name: '武夷山', aliases: ['Wuyi Mountain', '武夷山'], lat: 27.7310, lon: 117.9848 },
  { id: 'three-lanes-seven-alleys', name: '福州三坊七巷', aliases: ['Three Lanes and Seven Alleys', '三坊七巷'], lat: 26.0900, lon: 119.3000 },
  { id: 'gulangyu', name: '厦门鼓浪屿', aliases: ['Gulangyu', '鼓浪屿'], lat: 24.4478, lon: 118.0667 },
  { id: 'kaiyuan-temple-quanzhou', name: '泉州开元寺', aliases: ['Kaiyuan Temple Quanzhou', '开元寺'], lat: 24.9160, lon: 118.5850 },
  { id: 'canton-tower', name: '广州塔', aliases: ['Canton Tower', '小蛮腰'], lat: 23.1064, lon: 113.3245 },
  { id: 'window-of-the-world', name: '深圳世界之窗', aliases: ['Window of the World', '世界之窗'], lat: 22.5360, lon: 113.9730 },
  { id: 'ocean-park-hk', name: '香港海洋公园', aliases: ['Ocean Park', '海洋公园'], lat: 22.2417, lon: 114.1750 },
  { id: 'hong-kong-disneyland', name: '香港迪士尼乐园', aliases: ['Hong Kong Disneyland', '香港迪士尼'], lat: 22.3129, lon: 114.0410 },
  { id: 'ruins-of-st-pauls', name: '澳门大三巴牌坊', aliases: ['Ruins of St. Paul', '大三巴'], lat: 22.1970, lon: 113.5410 },
  // 中国（西南/西北）
  { id: 'kuanzhai-alley', name: '成都宽窄巷子', aliases: ['Kuanzhai Alley', '宽窄巷子'], lat: 30.6650, lon: 104.0570 },
  { id: 'jinli', name: '成都锦里', aliases: ['Jinli', '锦里'], lat: 30.6450, lon: 104.0550 },
  { id: 'chengdu-panda-base', name: '成都大熊猫基地', aliases: ['Chengdu Panda Base', '熊猫基地', '大熊猫'], lat: 30.7364, lon: 104.1451 },
  { id: 'dujiangyan', name: '都江堰', aliases: ['Dujiangyan', '都江堰'], lat: 31.0050, lon: 103.6200 },
  { id: 'qingcheng-mountain', name: '青城山', aliases: ['Qingcheng Mountain', '青城山'], lat: 30.9000, lon: 103.5800 },
  { id: 'emei-mountain', name: '峨眉山', aliases: ['Mount Emei', '峨眉山'], lat: 29.5460, lon: 103.3650 },
  { id: 'leshan-grand-buddha', name: '乐山大佛', aliases: ['Leshan Grand Buddha', '乐山大佛'], lat: 29.5430, lon: 103.7690 },
  { id: 'jiuzhaigou-yading', name: '稻城亚丁', aliases: ['Yading', '亚丁', '稻城'], lat: 28.4340, lon: 100.3133 },
  { id: 'lugu-lake', name: '泸沽湖', aliases: ['Lugu Lake', '泸沽湖'], lat: 27.7061, lon: 100.7831 },
  { id: 'erhai-lake', name: '大理洱海', aliases: ['Erhai Lake', '洱海'], lat: 25.7847, lon: 100.1833 },
  { id: 'dali-old-town', name: '大理古城', aliases: ['Dali Old Town', '大理'], lat: 25.6868, lon: 100.1651 },
  { id: 'lijiang-old-town', name: '丽江古城', aliases: ['Lijiang Old Town', '丽江'], lat: 26.8721, lon: 100.2330 },
  { id: 'jade-dragon-snow-mountain', name: '玉龙雪山', aliases: ['Jade Dragon Snow Mountain', '玉龙雪山'], lat: 27.0994, lon: 100.1750 },
  { id: 'meili-snow-mountain', name: '梅里雪山', aliases: ['Meili Snow Mountain', '梅里雪山'], lat: 28.4528, lon: 98.6942 },
  { id: 'xishuangbanna', name: '西双版纳', aliases: ['Xishuangbanna', '西双版纳'], lat: 22.0057, lon: 100.7944 },
  { id: 'stone-forest', name: '昆明石林', aliases: ['Stone Forest', '石林'], lat: 24.8180, lon: 103.3230 },
  { id: 'dianchi-lake', name: '昆明滇池', aliases: ['Dianchi Lake', '滇池'], lat: 24.9830, lon: 102.7000 },
  { id: 'huangguoshu-waterfall', name: '黄果树瀑布', aliases: ['Huangguoshu Waterfall', '黄果树'], lat: 25.9970, lon: 105.6670 },
  { id: 'xiaoqikong', name: '荔波小七孔', aliases: ['Xiaoqikong', '小七孔'], lat: 25.2450, lon: 107.7750 },
  { id: 'xijiang-miao-village', name: '西江千户苗寨', aliases: ['Xijiang Miao Village', '千户苗寨'], lat: 26.4167, lon: 108.1500 },
  { id: 'fanjing-mountain', name: '梵净山', aliases: ['Fanjing Mountain', '梵净山'], lat: 27.9200, lon: 108.6800 },
  { id: 'fenghuang-old-town', name: '凤凰古城', aliases: ['Fenghuang', '凤凰古城'], lat: 27.9483, lon: 109.5990 },
  { id: 'orange-islet', name: '长沙橘子洲', aliases: ['Orange Isle', '橘子洲'], lat: 28.1893, lon: 112.9720 },
  { id: 'yuelu-mountain', name: '长沙岳麓山', aliases: ['Yuelu Mountain', '岳麓山'], lat: 28.1820, lon: 112.9400 },
  { id: 'enshi-grand-canyon', name: '恩施大峡谷', aliases: ['Enshi Grand Canyon', '恩施大峡谷'], lat: 30.4977, lon: 109.3000 },
  { id: 'wudang-mountain', name: '武当山', aliases: ['Wudang Mountain', '武当山'], lat: 32.4742, lon: 111.0040 },
  { id: 'shennongjia', name: '神农架', aliases: ['Shennongjia', '神农架'], lat: 31.7350, lon: 110.6800 },
  { id: 'laojun-mountain', name: '洛阳老君山', aliases: ['Laojun Mountain', '老君山'], lat: 33.7210, lon: 111.6500 },
  { id: 'longmen-grottoes', name: '洛阳龙门石窟', aliases: ['Longmen Grottoes', '龙门石窟'], lat: 34.5540, lon: 112.4734 },
  { id: 'shaolin-temple', name: '嵩山少林寺', aliases: ['Shaolin Temple', '少林寺'], lat: 34.5072, lon: 112.9363 },
  { id: 'huashan', name: '西岳华山', aliases: ['Mount Hua', '华山'], lat: 34.4860, lon: 110.0840 },
  { id: 'qianhu-miao-village', name: '重庆洪崖洞', aliases: ['Hongya Cave', '洪崖洞'], lat: 29.5653, lon: 106.5800 },
  { id: 'wulong-three-bridges', name: '重庆武隆天生三桥', aliases: ['Wulong Three Natural Bridges', '天生三桥'], lat: 29.4000, lon: 107.7667 },
  { id: 'chongqing-jiefangbei', name: '重庆解放碑', aliases: ['Jiefangbei', '解放碑'], lat: 29.5568, lon: 106.5750 },
  { id: 'mogao-caves', name: '敦煌莫高窟', aliases: ['Mogao Caves', '莫高窟', '敦煌'], lat: 40.0405, lon: 94.8094 },
  { id: 'crescent-lake', name: '鸣沙山月牙泉', aliases: ['Crescent Lake', '月牙泉', '鸣沙山'], lat: 40.0869, lon: 94.6640 },
  { id: 'zhangye-danxia', name: '张掖七彩丹霞', aliases: ['Zhangye Danxia', '七彩丹霞'], lat: 38.9622, lon: 100.1561 },
  { id: 'qinghai-lake', name: '青海湖', aliases: ['Qinghai Lake', '青海湖'], lat: 36.8907, lon: 100.1923 },
  { id: 'chaka-salt-lake', name: '茶卡盐湖', aliases: ['Chaka Salt Lake', '茶卡盐湖'], lat: 36.7024, lon: 99.0915 },
  { id: 'tianshan-tianchi', name: '天山天池', aliases: ['Tianshan Tianchi', '天山天池'], lat: 43.8809, lon: 88.1208 },
  { id: 'sayram-lake', name: '赛里木湖', aliases: ['Sayram Lake', '赛里木湖'], lat: 44.5947, lon: 81.1741 },
  { id: 'kanas-lake', name: '喀纳斯湖', aliases: ['Kanas Lake', '喀纳斯'], lat: 48.7069, lon: 87.0338 },
  { id: 'kashgar-old-city', name: '喀什古城', aliases: ['Kashgar Old City', '喀什'], lat: 39.4650, lon: 75.9880 },
  { id: 'grape-valley', name: '吐鲁番葡萄沟', aliases: ['Grape Valley', '葡萄沟', '吐鲁番'], lat: 42.9300, lon: 89.1900 },
  { id: 'everest-base-camp', name: '珠峰大本营', aliases: ['Everest Base Camp', '珠峰'], lat: 28.1320, lon: 86.8500 },
  { id: 'namtso', name: '纳木错', aliases: ['Namtso', '纳木错'], lat: 30.7144, lon: 90.5811 },
  { id: 'barkhor-street', name: '拉萨八廓街', aliases: ['Barkhor Street', '八廓街'], lat: 29.6540, lon: 91.1350 },
  { id: 'yalong-bay', name: '三亚亚龙湾', aliases: ['Yalong Bay', '亚龙湾'], lat: 18.2320, lon: 109.6360 },
  { id: 'wuzhizhou-island', name: '三亚蜈支洲岛', aliases: ['Wuzhizhou Island', '蜈支洲岛'], lat: 18.3100, lon: 109.7600 },
  { id: 'haikou-arcade-street', name: '海口骑楼老街', aliases: ['Haikou Arcade Street', '骑楼老街'], lat: 20.0450, lon: 110.3430 },
  // 中国（港澳台）
  { id: 'national-palace-museum', name: '台北故宫博物院', aliases: ['National Palace Museum', '台北故宫'], lat: 25.1017, lon: 121.5480 },
  { id: 'alishan', name: '阿里山', aliases: ['Alishan', '阿里山'], lat: 23.5250, lon: 120.8120 },
  { id: 'sun-moon-lake', name: '日月潭', aliases: ['Sun Moon Lake', '日月潭'], lat: 23.8600, lon: 120.9250 },
  { id: 'kenting', name: '垦丁', aliases: ['Kenting', '垦丁'], lat: 21.9430, lon: 120.7990 },
  // 亚洲其他
  { id: 'kiyomizu-dera', name: '京都清水寺', aliases: ['Kiyomizu-dera', '清水寺'], lat: 34.9949, lon: 135.7850 },
  { id: 'osaka-castle', name: '大阪城', aliases: ['Osaka Castle', '大阪城'], lat: 34.6873, lon: 135.5262 },
  { id: 'universal-studios-japan', name: '大阪环球影城', aliases: ['Universal Studios Japan', '环球影城'], lat: 34.6654, lon: 135.4324 },
  { id: 'todaiji', name: '奈良东大寺', aliases: ['Todai-ji', '东大寺', '奈良'], lat: 34.6889, lon: 135.8398 },
  { id: 'disneyland-tokyo', name: '东京迪士尼乐园', aliases: ['Tokyo Disneyland', '东京迪士尼'], lat: 35.6329, lon: 139.8807 },
  { id: 'hakone', name: '箱根温泉', aliases: ['Hakone', '箱根'], lat: 35.2320, lon: 139.1060 },
  { id: 'furano', name: '北海道富良野', aliases: ['Furano', '富良野'], lat: 43.3396, lon: 142.3942 },
  { id: 'hakodate-mountain', name: '函馆山夜景', aliases: ['Hakodate Mountain', '函馆山'], lat: 41.7590, lon: 140.7040 },
  { id: 'churaumi-aquarium', name: '冲绳美丽海水族馆', aliases: ['Churaumi Aquarium', '美丽海水族馆'], lat: 26.6940, lon: 127.8780 },
  { id: 'gyeongbokgung', name: '首尔景福宫', aliases: ['Gyeongbokgung', '景福宫'], lat: 37.5796, lon: 126.9770 },
  { id: 'myeongdong', name: '首尔明洞', aliases: ['Myeongdong', '明洞'], lat: 37.5636, lon: 126.9850 },
  { id: 'namsan-tower', name: '首尔南山塔', aliases: ['N Seoul Tower', '南山塔'], lat: 37.5512, lon: 126.9882 },
  { id: 'haeundae', name: '釜山海云台', aliases: ['Haeundae', '海云台'], lat: 35.1587, lon: 129.1607 },
  { id: 'hallasan', name: '济州岛汉拿山', aliases: ['Hallasan', '汉拿山', '济州岛'], lat: 33.3620, lon: 126.5330 },
  { id: 'grand-palace-bangkok', name: '曼谷大皇宫', aliases: ['Grand Palace', '大皇宫', '曼谷'], lat: 13.7500, lon: 100.4914 },
  { id: 'siam-square', name: '曼谷暹罗广场', aliases: ['Siam Square', '暹罗广场'], lat: 13.7450, lon: 100.5340 },
  { id: 'chiang-mai-old-city', name: '清迈古城', aliases: ['Chiang Mai Old City', '清迈'], lat: 18.7883, lon: 98.9853 },
  { id: 'phuket', name: '普吉岛', aliases: ['Phuket', '普吉'], lat: 7.8804, lon: 98.3923 },
  { id: 'tanah-lot', name: '巴厘岛海神庙', aliases: ['Tanah Lot', '海神庙', '巴厘岛'], lat: -8.6210, lon: 115.0870 },
  { id: 'ubud', name: '巴厘岛乌布', aliases: ['Ubud', '乌布'], lat: -8.5069, lon: 115.2620 },
  { id: 'petronas-towers', name: '吉隆坡双子塔', aliases: ['Petronas Towers', '双子塔'], lat: 3.1579, lon: 101.7118 },
  { id: 'langkawi', name: '兰卡威', aliases: ['Langkawi', '兰卡威'], lat: 6.3500, lon: 99.8000 },
  { id: 'burj-al-arab', name: '迪拜帆船酒店', aliases: ['Burj Al Arab', '帆船酒店'], lat: 25.1412, lon: 55.1853 },
  { id: 'sheikh-zayed-mosque', name: '阿布扎比大清真寺', aliases: ['Sheikh Zayed Mosque', '大清真寺'], lat: 24.4129, lon: 54.4748 },
  { id: 'sigiriya', name: '斯里兰卡狮子岩', aliases: ['Sigiriya', '狮子岩'], lat: 7.9560, lon: 80.7600 },
  { id: 'male', name: '马尔代夫马累', aliases: ['Male', '马尔代夫'], lat: 4.1755, lon: 73.5093 },
  // 欧洲
  { id: 'louvre-museum', name: '巴黎卢浮宫', aliases: ['Louvre Museum', '卢浮宫'], lat: 48.8606, lon: 2.3376 },
  { id: 'notre-dame', name: '巴黎圣母院', aliases: ['Notre-Dame', '巴黎圣母院'], lat: 48.8530, lon: 2.3499 },
  { id: 'mont-saint-michel', name: '圣米歇尔山', aliases: ['Mont Saint-Michel', '圣米歇尔山'], lat: 48.6361, lon: -1.5115 },
  { id: 'st-marks-square', name: '威尼斯圣马可广场', aliases: ["St. Mark's Square", '圣马可广场'], lat: 45.4340, lon: 12.3380 },
  { id: 'leaning-tower-pisa', name: '比萨斜塔', aliases: ['Leaning Tower of Pisa', '比萨斜塔'], lat: 43.7230, lon: 10.3966 },
  { id: 'duomo-milan', name: '米兰大教堂', aliases: ['Duomo di Milano', '米兰大教堂'], lat: 45.4642, lon: 9.1919 },
  { id: 'sagrada-familia', name: '巴塞罗那圣家堂', aliases: ['Sagrada Familia', '圣家堂'], lat: 41.4036, lon: 2.1744 },
  { id: 'belem-tower', name: '里斯本贝伦塔', aliases: ['Belem Tower', '贝伦塔'], lat: 38.6916, lon: -9.2160 },
  { id: 'amsterdam-canals', name: '阿姆斯特丹运河', aliases: ['Amsterdam Canals', '运河区'], lat: 52.3738, lon: 4.8909 },
  { id: 'grand-place-brussels', name: '布鲁塞尔大广场', aliases: ['Grand Place', '大广场'], lat: 50.8467, lon: 4.3525 },
  { id: 'neuschwanstein-castle', name: '新天鹅堡', aliases: ['Neuschwanstein Castle', '新天鹅堡'], lat: 47.5576, lon: 10.7498 },
  { id: 'brandenburg-gate', name: '柏林勃兰登堡门', aliases: ['Brandenburg Gate', '勃兰登堡门'], lat: 52.5163, lon: 13.3777 },
  { id: 'jungfraujoch', name: '瑞士少女峰', aliases: ['Jungfraujoch', '少女峰'], lat: 46.5475, lon: 7.9852 },
  { id: 'tower-bridge-london', name: '伦敦塔桥', aliases: ['Tower Bridge', '塔桥'], lat: 51.5055, lon: -0.0754 },
  { id: 'big-ben', name: '伦敦大本钟', aliases: ['Big Ben', '大本钟'], lat: 51.5007, lon: -0.1246 },
  { id: 'london-eye', name: '伦敦眼', aliases: ['London Eye', '伦敦眼'], lat: 51.5033, lon: -0.1197 },
  { id: 'edinburgh-castle', name: '爱丁堡城堡', aliases: ['Edinburgh Castle', '爱丁堡'], lat: 55.9486, lon: -3.1999 },
  { id: 'cliffs-of-moher', name: '莫赫悬崖', aliases: ['Cliffs of Moher', '莫赫悬崖'], lat: 52.9715, lon: -9.4265 },
  { id: 'red-square', name: '莫斯科红场', aliases: ['Red Square', '红场'], lat: 55.7539, lon: 37.6208 },
  { id: 'winter-palace', name: '圣彼得堡冬宫', aliases: ['Winter Palace', '冬宫'], lat: 59.9398, lon: 30.3146 },
  { id: 'charles-bridge', name: '布拉格查理大桥', aliases: ['Charles Bridge', '查理大桥'], lat: 50.0865, lon: 14.4115 },
  { id: 'schoenbrunn-palace', name: '维也纳美泉宫', aliases: ['Schoenbrunn Palace', '美泉宫'], lat: 48.1845, lon: 16.3121 },
  { id: 'fisherman-bastion', name: '布达佩斯渔人堡', aliases: ['Fisherman\'s Bastion', '渔人堡'], lat: 47.5020, lon: 19.0390 },
  { id: 'helsinki-cathedral', name: '赫尔辛基大教堂', aliases: ['Helsinki Cathedral', '赫尔辛基大教堂'], lat: 60.1704, lon: 24.9525 },
  { id: 'gamla-stan', name: '斯德哥尔摩老城', aliases: ['Gamla Stan', '斯德哥尔摩老城'], lat: 59.3258, lon: 18.0710 },
  { id: 'little-mermaid', name: '哥本哈根小美人鱼', aliases: ['Little Mermaid', '小美人鱼'], lat: 55.6929, lon: 12.5993 },
  // 美洲/大洋洲/非洲
  { id: 'statue-of-liberty', name: '纽约自由女神像', aliases: ['Statue of Liberty', '自由女神'], lat: 40.6892, lon: -74.0445 },
  { id: 'times-square', name: '纽约时代广场', aliases: ['Times Square', '时代广场'], lat: 40.7580, lon: -73.9855 },
  { id: 'central-park', name: '纽约中央公园', aliases: ['Central Park', '中央公园'], lat: 40.7829, lon: -73.9654 },
  { id: 'white-house', name: '华盛顿白宫', aliases: ['White House', '白宫'], lat: 38.8977, lon: -77.0365 },
  { id: 'las-vegas-strip', name: '拉斯维加斯大道', aliases: ['Las Vegas Strip', '拉斯维加斯'], lat: 36.1147, lon: -115.1728 },
  { id: 'hollywood-sign', name: '洛杉矶好莱坞标志', aliases: ['Hollywood Sign', '好莱坞'], lat: 34.1341, lon: -118.3215 },
  { id: 'disneyland-anaheim', name: '加州迪士尼乐园', aliases: ['Disneyland', '加州迪士尼'], lat: 33.8121, lon: -117.9190 },
  { id: 'niagara-falls', name: '尼亚加拉大瀑布', aliases: ['Niagara Falls', '尼亚加拉'], lat: 43.0962, lon: -79.0377 },
  { id: 'banff-national-park', name: '班夫国家公园', aliases: ['Banff', '班夫'], lat: 51.4968, lon: -115.9281 },
  { id: 'cn-tower', name: '多伦多CN塔', aliases: ['CN Tower', 'CN塔'], lat: 43.6426, lon: -79.3871 },
  { id: 'chichen-itza', name: '奇琴伊察', aliases: ['Chichen Itza', '奇琴伊察'], lat: 20.6843, lon: -88.5678 },
  { id: 'christ-the-redeemer', name: '里约基督像', aliases: ['Christ the Redeemer', '基督像'], lat: -22.9519, lon: -43.2105 },
  { id: 'great-barrier-reef', name: '大堡礁', aliases: ['Great Barrier Reef', '大堡礁'], lat: -16.9203, lon: 145.7710 },
  { id: 'queenstown', name: '新西兰皇后镇', aliases: ['Queenstown', '皇后镇'], lat: -45.0312, lon: 168.6626 },
  { id: 'hobbiton', name: '新西兰霍比特村', aliases: ['Hobbiton', '霍比特村'], lat: -37.8721, lon: 175.6823 },
  { id: 'cape-of-good-hope', name: '好望角', aliases: ['Cape of Good Hope', '好望角'], lat: -34.3561, lon: 18.4737 },
  { id: 'masai-mara', name: '马赛马拉国家保护区', aliases: ['Masai Mara', '马赛马拉'], lat: -1.4800, lon: 35.1000 },
  { id: 'serengeti', name: '塞伦盖蒂国家公园', aliases: ['Serengeti', '塞伦盖蒂'], lat: -2.3333, lon: 34.8333 },
]);

export const TOURISM_DEFAULTS = Object.freeze({
  radiusM: 180,
  minAltM: 80,
  photoCount: 6,
});

export function normalizePlaceQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFKC');
}

export function searchTourismPlaces(query, limit = 8) {
  const term = normalizePlaceQuery(query);
  if (!term) return [];
  const exact = [];
  const partial = [];
  TOURISM_GAZETTEER.forEach((place) => {
    const haystack = normalizePlaceQuery([place.name, ...(place.aliases || [])].join(' '));
    if (haystack === term || place.id.toLowerCase() === term) {
      exact.push(place);
      return;
    }
    if (haystack.includes(term)) partial.push(place);
  });
  const ranked = [...exact, ...partial];
  if (ranked.length > limit) ranked.length = limit;
  return ranked;
}

export function findTourismPlace(query) {
  const term = normalizePlaceQuery(query);
  if (!term) return null;
  const direct = TOURISM_GAZETTEER.find(
    (place) => normalizePlaceQuery(place.name) === term
      || place.id.toLowerCase() === term
      || (place.aliases || []).some((alias) => normalizePlaceQuery(alias) === term),
  );
  if (direct) return direct;
  return searchTourismPlaces(term, 1)[0] || null;
}

export function parseCoordinateInput(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  const latLon = text.match(/^([+-]?\d{1,2}(?:\.\d+)?)[,\s]+([+-]?\d{1,3}(?:\.\d+)?)$/);
  if (!latLon) return null;
  const lat = Number(latLon[1]);
  const lon = Number(latLon[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function resolveTourismTarget(value) {
  if (!value) return null;
  const coordinates = parseCoordinateInput(value);
  if (coordinates) {
    return { ...coordinates, name: `${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}`, source: 'coordinate' };
  }
  const place = findTourismPlace(value);
  if (place) return { lat: place.lat, lon: place.lon, name: place.name, source: 'gazetteer' };
  return null;
}

export function destinationFromBearing(lat, lon, distanceM, bearingDeg) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const nextLat = Math.asin(
    Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
  );
  const nextLon = lonRad + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
    Math.cos(angular) - Math.sin(latRad) * Math.sin(nextLat),
  );
  return {
    lat: (nextLat * 180) / Math.PI,
    lon: ((nextLon * 180) / Math.PI + 540) % 360 - 180,
  };
}

export function bearingBetween(lat1, lon1, lat2, lon2) {
  const aLat = (lat1 * Math.PI) / 180;
  const bLat = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(bLat);
  const x = Math.cos(aLat) * Math.sin(bLat) - Math.sin(aLat) * Math.cos(bLat) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function segmentDuration(metres, speed) {
  return Math.max(600, (metres / speed) * 1000);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function buildTourismObservationPoints(target, options = {}) {
  const lat = Number(target.lat);
  const lon = Number(target.lon);
  const radiusM = clampNumber(options.radiusM, 40, 2000, TOURISM_DEFAULTS.radiusM);
  const minAltM = clampNumber(options.minAltM, 20, 1000, TOURISM_DEFAULTS.minAltM);
  const photoCount = Math.max(5, Math.min(12, Math.round(Number(options.photoCount) || TOURISM_DEFAULTS.photoCount)));
  const ringCount = photoCount - 1;
  const points = [
    {
      id: 'center',
      label: 'Center',
      lat,
      lon,
      alt: minAltM + 24,
      radiusM: 0,
      bearingDeg: 0,
    },
  ];
  for (let index = 0; index < ringCount; index += 1) {
    const bearingDeg = (360 / ringCount) * index - 90;
    const position = destinationFromBearing(lat, lon, radiusM, bearingDeg);
    points.push({
      id: `angle-${index + 1}`,
      label: `A${index + 1}`,
      lat: position.lat,
      lon: position.lon,
      alt: minAltM + 18 + (index % 3) * 6,
      radiusM,
      bearingDeg: normalizeBearing(bearingDeg),
    });
  }
  return points;
}

function buildRoute(routeIndex, observationPoint, drone, launch, target) {
  const cruiseAlt = observationPoint.alt;
  const launchAir = { ...launch, alt: cruiseAlt };
  const observe = {
    lat: observationPoint.lat,
    lon: observationPoint.lon,
    alt: cruiseAlt,
  };
  const climb = Math.max(0, cruiseAlt - GROUND_ALT);
  const flyDistance = Math.hypot(
    (observe.lat - launch.lat) * 111_320,
    (observe.lon - launch.lon) * 111_320 * Math.max(0.2, Math.cos((launch.lat * Math.PI) / 180)),
  );
  const segments = [
    {
      from: launch,
      to: launchAir,
      durationMs: segmentDuration(climb, DEFAULT_CLIMB_SPEED_MS),
      holdMs: 0,
      phase: 'takeoff',
    },
    {
      from: launchAir,
      to: observe,
      durationMs: segmentDuration(flyDistance, DEFAULT_CRUISE_SPEED_MS),
      holdMs: OBSERVE_HOLD_MS,
      phase: 'enroute',
    },
    {
      from: observe,
      to: launchAir,
      durationMs: segmentDuration(flyDistance, DEFAULT_CRUISE_SPEED_MS * 1.25),
      holdMs: 0,
      phase: 'returning',
    },
    {
      from: launchAir,
      to: launch,
      durationMs: segmentDuration(climb, DEFAULT_LANDING_SPEED_MS),
      holdMs: 0,
      phase: 'landing',
    },
  ];
  return {
    routeId: `tourism-${String(routeIndex + 1).padStart(2, '0')}`,
    droneId: drone.droneId,
    observationId: observationPoint.id,
    label: observationPoint.label,
    targetLabel: observationPoint.label,
    bearingDeg: observationPoint.bearingDeg,
    delayMs: routeIndex * 2600,
    totalMs: segments.reduce((sum, item) => sum + item.durationMs + item.holdMs, 0),
    segments,
    observation: {
      ...observationPoint,
      bearingToCenter: normalizeBearing(
        bearingBetween(observationPoint.lat, observationPoint.lon, target.lat, target.lon) + 180,
      ),
    },
  };
}

export function planTourismObservationMission(drones, target, options = {}) {
  const available = (Array.isArray(drones) ? drones : []).filter((drone) => !drone.local && drone.online !== false);
  if (!available.length) return null;
  const observationPoints = buildTourismObservationPoints(target, options);
  const launchPoints = available.map((drone, index) => {
    const position = destinationFromBearing(target.lat, target.lon, 26 + (index % 3) * 7, index * 137);
    return {
      lat: position.lat,
      lon: position.lon,
      alt: GROUND_ALT,
    };
  });
  const routes = observationPoints.map((point, index) => {
    const drone = available[index % available.length];
    return buildRoute(index, point, drone, launchPoints[index % available.length], target);
  });
  return {
    id: `tourism-${Date.now().toString(36)}`,
    kind: 'tourism',
    target: {
      lat: Number(target.lat),
      lon: Number(target.lon),
      name: String(target.name || 'Tourist place'),
    },
    radiusM: observationPoints[1]?.radiusM || TOURISM_DEFAULTS.radiusM,
    minAltM: Math.min(...observationPoints.map((point) => point.alt)),
    photoCount: observationPoints.length,
    createdAt: Date.now(),
    routes,
    observations: [],
    completed: false,
  };
}

export function sampleTourismRoute(route, elapsedMs) {
  const delayed = elapsedMs - route.delayMs;
  if (delayed <= 0) {
    return {
      ...route.segments[0].from,
      phase: 'queued',
      progress: 0,
      complete: false,
      photoTaken: false,
    };
  }
  let cursor = 0;
  for (const segment of route.segments) {
    const segmentEnd = cursor + segment.durationMs;
    if (delayed <= segmentEnd) {
      const progress = Math.max(0, Math.min(1, (delayed - cursor) / segment.durationMs));
      return {
        lat: segment.from.lat + (segment.to.lat - segment.from.lat) * progress,
        lon: segment.from.lon + (segment.to.lon - segment.from.lon) * progress,
        alt: segment.from.alt + (segment.to.alt - segment.from.alt) * progress,
        phase: segment.phase,
        progress: Math.min(0.99, delayed / route.totalMs),
        complete: false,
        photoTaken: false,
      };
    }
    cursor = segmentEnd;
    if (delayed <= cursor + segment.holdMs) {
      return {
        ...segment.to,
        phase: segment.phase === 'enroute' ? 'onstation' : segment.phase,
        progress: Math.min(0.99, delayed / route.totalMs),
        complete: false,
        photoTaken: false,
      };
    }
    cursor += segment.holdMs;
  }
  const last = route.segments.at(-1).to;
  return {
    ...last,
    phase: 'parked',
    progress: 1,
    complete: true,
    photoTaken: false,
  };
}

export function advanceTourismMission(mission, deltaMs) {
  if (!mission?.routes?.length || mission.completed) return [];
  const states = [];
  mission.routes.forEach((route) => {
    const elapsed = Number(route.elapsedMs || 0);
    const proposedElapsed = elapsed + Math.max(0, Math.min(500, Number(deltaMs) || 0));
    const next = sampleTourismRoute(route, proposedElapsed);
    route.elapsedMs = proposedElapsed;
    route.complete = next.complete;
    if (next.phase === 'onstation' && !route.observationRecorded) {
      route.observationRecorded = true;
      mission.observations.push({
        routeId: route.routeId,
        observationId: route.observationId,
        label: route.label,
        lat: next.lat,
        lon: next.lon,
        alt: next.alt,
        at: Date.now(),
      });
    }
    states.push({ droneId: route.droneId, ...next });
  });
  if (mission.routes.every((route) => route.complete)) {
    mission.completed = true;
  }
  return states;
}

export function tourismRoutePolyline(route) {
  const points = [];
  route.segments.forEach((segment) => {
    if (!points.length) points.push({ ...segment.from });
    points.push({ ...segment.to });
  });
  return points;
}

export function tourismCameraPitch(alt, horizontalDistanceM, targetAltitude = 0) {
  const deltaAlt = Math.max(8, Number(alt) - Number(targetAltitude || 0));
  const distance = Math.max(8, Number(horizontalDistanceM));
  return -Math.max(22, Math.min(62, Math.atan2(deltaAlt, distance) * (180 / Math.PI) + 8));
}
