import { Common } from '../common.ts'

import type { RouterMiddleware } from '@oak/oak'

// fetch("https://d1.weather.com.cn/sk_2d/101190101.html", {
//   "headers": {
//     "cookie": "f_city=%E5%8D%97%E4%BA%AC%7C101190101%7C",
//     "Referer": "https://www.weather.com.cn/",
//   },
// }).then(e=>e.text()).then(console.log);

// var dataSK={"nameen":"nanjing","cityname":"南京","city":"101190101","temp":"31.8","tempf":"89.2","WD":"北风","wde":"N","WS":"2级","wse":"8km\/h","SD":"65%","sd":"65%","qy":"999","njd":"14km","time":"09:35","rain":"0","rain24h":"0","aqi":"33","aqi_pm25":"33","weather":"多云","weathere":"Cloudy","weathercode":"d01","limitnumber":"","date":"07月14日(星期一)"}

class ServiceWeather {
  private options = (options?: { name: string; code: string }) => {
    const { name = '南京', code = '101190101' } = options || {}
    return {
      headers: {
        cookie: `f_city=${encodeURIComponent(`${name}|${code}|`)}`,
        referer: 'https://www.weather.com.cn/',
      },
    }
  }

  handle(): RouterMiddleware<'/weather'> {
    return async (ctx) => {
      const query = ctx.request.url.searchParams.get('query') || ''
      const location = await this.fetchLocation(query)
      const realtime = await this.fetchRealtime(query)

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = { realtime, location }
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson({ realtime, location })
          break
      }
    }
  }

  handle7d(): RouterMiddleware<'/weather/7d'> {
    return async (ctx) => {
      // const data = await this.#fetch()

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = 'weather: todo'
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson('weather: todo')
          break
      }
    }
  }

  async fetchLocation(name: string) {
    const api = `https://toy1.weather.com.cn/search?cityname=${encodeURIComponent(name)}&callback=success_jsonpCallback&_=${Date.now()}`

    const res = (await (await fetch(api, this.options())).text())
      .replace(/^success_jsonpCallback\(/, '')
      .replace(/\)$/, '')

    let locationStr = ''

    try {
      locationStr = JSON.parse(res ?? '{}')?.[0]?.ref ?? ''
    } catch {
      throw new Error('地点响应解析失败，请求返回内容: ' + res)
    }

    if (!locationStr) throw new Error('未查询到该地点，请求返回内容: ' + res)

    return this.parseLocationId(locationStr)
  }

  async fetchRealtime(search: string) {
    const parsed = await this.fetchLocation(search)

    // const url = `https://d1.weather.com.cn/dingzhi/${parsed.location_id}.html?_=${Date.now()}`
    // const url = `https://d1.weather.com.cn/sk_2d/${parsed.location_id}.html?_=${Date.now()}`
    const url = `https://d1.weather.com.cn/weather_index/${parsed.location_id}.html?_=${Date.now()}`

    // const url = parsed.is_town
    //   ? `https://d1.weather.com.cn/dingzhi/${parsed.location_id}.html?_=${Date.now()}`
    // : `https://d1.weather.com.cn/sk_2d/${parsed.location_id}.html?_=${Date.now()}`

    const dataList = (
      await (await fetch(url, this.options({ name: parsed.formatted, code: parsed.location_id }))).text()
    )
      .split(/[=;]/)
      .filter((e) => !e.includes('var'))
      .map((e) => JSON.parse(e.trim()))

    // .replace(/^\s*var\s*dataSK=/i, '')
    // .replace(new RegExp(`var\\s*cityDZ${parsed.location_id}\\s*=\\s*`), '')
    // .replace(new RegExp(`;\\s*var(.*)+$`), '')

    const [dataDZ, alarmDZ, dataSK, dataZS, fc] = dataList

    return {
      weather: dataDZ?.weatherinfo?.weather,
      weather_code_day: dataDZ?.weatherinfo?.weathercode,
      weather_code_night: dataDZ?.weatherinfo?.weathercoden,
      temperature_day: +dataDZ?.weatherinfo?.temp?.replace('℃', ''),
      temperature_night: +dataDZ?.weatherinfo?.tempn?.replace('℃', ''),
      wind_strength: dataDZ?.weatherinfo?.ws ?? dataDZ?.weatherinfo?.WS,
      wind_direction: dataDZ?.weatherinfo?.wd ?? dataDZ?.weatherinfo?.WD,
      forecast_time: dataDZ?.weatherinfo?.fctime
        ? this.parseForecastTime(dataDZ?.weatherinfo?.fctime ?? '').toLocaleString('zh-CN')
        : null,
      forecast_time_at: dataDZ?.weatherinfo?.fctime
        ? this.parseForecastTime(dataDZ?.weatherinfo?.fctime ?? '').getTime()
        : null,

      raw: dataList,
    }
  }

  async fetch7d() {
    const api = ''
    const { data = {} } = await (await fetch(api)).json()

    //
  }

  parseLocationId(location: string) {
    // 101240504015
    // 101270101002~sichuan~二仙桥街道~erxianqiaojiedao~成华~chenghua~028~610000~sichuan~四川

    const [locationId, _, town, townId, city, cityId, areaCode, zipCode, __, province] = location.split('~')

    const isProvince = town === city && city === province
    const isCity = town === city && city !== province
    const isTown = town !== city && city !== province

    return {
      province,
      city,
      town,

      formatted: isTown ? `${province}${city}${town}` : isCity ? `${province}${city}` : isProvince ? province : '',

      location_id: locationId,

      detail_url: /\d{11}/.test(locationId)
        ? `http://forecast.weather.com.cn/town/weathern/${locationId}.shtml` // 11
        : /\d{9}/.test(locationId)
          ? `http://www.weather.com.cn/weather/${locationId}.shtml` // 9
          : /[a-zA-Z]+/.test(locationId)
            ? `http://www.weather.com.cn/html/province/${locationId}.shtml` //
            : '',

      is_province: isProvince,
      is_city: isCity,
      is_town: isTown,

      area_code: areaCode,
      zip_code: zipCode,
    }
  }

  parseForecastTime(time: string) {
    const cleanTime = time.replace(/\D/g, '')
    const year = cleanTime.substring(0, 4)
    const month = cleanTime.substring(4, 6)
    const day = cleanTime.substring(6, 8)
    const hour = cleanTime.substring(8, 10) || '00'
    const minute = cleanTime.substring(10, 12) || '00'
    const second = cleanTime.substring(12, 14) || '00'
    return new Date(+year, +month - 1, +day, +hour, +minute, +second)
  }
}

export const serviceWeather = new ServiceWeather()

// await serviceWeather.fetchRealtime('雨花台').then(console.log)

// var Z = {
//   '00': '晴',
//   '01': '多云',
//   '02': '阴',
//   '03': '阵雨',
//   '04': '雷阵雨',
//   '05': '雷阵雨伴有冰雹',
//   '06': '雨夹雪',
//   '07': '小雨',
//   '08': '中雨',
//   '09': '大雨',
//   10: '暴雨',
//   11: '大暴雨',
//   12: '特大暴雨',
//   13: '阵雪',
//   14: '小雪',
//   15: '中雪',
//   16: '大雪',
//   17: '暴雪',
//   18: '雾',
//   19: '冻雨',
//   20: '沙尘暴',
//   21: '小到中雨',
//   22: '中到大雨',
//   23: '大到暴雨',
//   24: '暴雨到大暴雨',
//   25: '大暴雨到特大暴雨',
//   26: '小到中雪',
//   27: '中到大雪',
//   28: '大到暴雪',
//   29: '浮尘',
//   30: '扬沙',
//   31: '强沙尘暴',
//   53: '霾',
//   99: '无',
//   32: '浓雾',
//   49: '强浓雾',
//   54: '中度霾',
//   55: '重度霾',
//   56: '严重霾',
//   57: '大雾',
//   58: '特强浓雾',
//   301: '雨',
//   302: '雪',
// }

// https://d1.weather.com.cn/dataset/todayRank.html?callback=todayRank&_=1753868003580
// https://j.i8tq.com/weather2020/search/city.js

//  const url = `https://d1.weather.com.cn/dingzhi/${parsed.location_id}.html?_=${Date.now()}`

// var cityDZ101190101067 = {
//   weatherinfo: {
//     temp: '22℃',
//     weathercode: 'n08',
//     city: '101190101067',
//     cityname: '铁心桥街道',
//     tempn: '24℃',
//     weather: '中雨',
//     ws: '4-5级转3-4级',
//     fctime: '2025073108',
//     wd: '北风转东北风',
//     weathercoden: 'd08',
//   },
// }
// var alarmDZ101190101067 = { w: [] }

//  const url = `https://d1.weather.com.cn/sk_2d/${parsed.location_id}.html?_=${Date.now()}`

// var dataSK = {
//   nameen: 'yuhuatai',
//   cityname: '雨花台',
//   city: '101190113',
//   temp: '25.4',
//   tempf: '77.7',
//   WD: '北风',
//   wde: 'N',
//   WS: '3级',
//   wse: '16km\\/h',
//   SD: '92%',
//   sd: '92%',
//   qy: '991',
//   njd: '25km',
//   time: '17:35',
//   rain: '0.5',
//   rain24h: '0.5',
//   aqi: '10',
//   aqi_pm25: '10',
//   weather: '雨',
//   weathere: null,
//   weathercode: 'd301',
//   limitnumber: '',
//   date: '07月30日(星期三)',
// }

//  const url = `https://d1.weather.com.cn/weather_index/${parsed.location_id}.html?_=${Date.now()}`

// var cityDZ = {
//   weatherinfo: {
//     city: '雨花台',
//     cityname: 'yuhuatai',
//     temp: '999',
//     tempn: '23',
//     weather: '小雨转暴雨',
//     wd: '北风',
//     ws: '3-4级转5-6级',
//     weathercode: 'd7',
//     weathercoden: 'n10',
//     fctime: '202507300800',
//   },
// }
// var alarmDZ = {
//   w: [
//     {
//       w1: '江苏省',
//       w2: '',
//       w3: '',
//       w4: '02',
//       w5: '暴雨',
//       w6: '02',
//       w7: '黄色',
//       w8: '2025-07-30 09:45',
//       w9: '江苏省气象台2025年07月30日09时45分升级发布暴雨黄色预警：预计今天白天至夜间，无锡、常州、苏州、南通、盐城、扬州东部、泰州等地的大部分地区将出现雨量100毫米以上的强降雨，局部可达180-260毫米。省应急厅（省防减救灾办）、省气象局提醒注意防范。（预警信息来源：国家预警信息发布中心）',
//       w10: '202507300945582382暴雨黄色',
//       w11: '10119-20250730094509-0202.html',
//       w12: '2025-07-30 09:50',
//       w13: '江苏省发布暴雨黄色预警',
//       w14: 'Update',
//       w15: '2025-07-31 09:45:09',
//       w16: '32000041600000_20250730094509',
//     },
//   ],
// }
// var dataSK = {
//   nameen: 'yuhuatai',
//   cityname: '雨花台',
//   city: '101190113',
//   temp: '25.4',
//   tempf: '77.7',
//   WD: '北风',
//   wde: 'N',
//   WS: '3级',
//   wse: '14km\\/h',
//   SD: '94%',
//   sd: '94%',
//   qy: '991',
//   njd: '19km',
//   time: '17:30',
//   rain: '0.5',
//   rain24h: '0.5',
//   aqi: '10',
//   aqi_pm25: '10',
//   weather: '雨',
//   weathere: null,
//   weathercode: 'd301',
//   limitnumber: '',
//   date: '07月30日(星期三)',
// }
// var dataZS = {
//   zs: {
//     date: '2025073011',
//     lk_name: '路况指数',
//     lk_hint: '潮湿',
//     lk_des_s: '有降水，路面潮湿，请小心驾驶。',
//     cl_name: '晨练指数',
//     cl_hint: '不宜',
//     cl_des_s: '有降水，请尽量避免户外晨练。',
//     nl_name: '夜生活指数',
//     nl_hint: '较不适宜',
//     nl_des_s: '建议夜生活最好在室内进行。',
//     gm_name: '感冒指数',
//     gm_hint: '少发',
//     gm_des_s: '感冒机率较低，避免长期处于空调屋中。',
//     gj_name: '逛街指数',
//     gj_hint: '较不宜',
//     gj_des_s: '有降水，较不适宜逛街',
//     pl_name: '空气污染扩散条件指数',
//     pl_hint: '优',
//     pl_des_s: '气象条件非常有利于空气污染物扩散。',
//     tr_name: '旅游指数',
//     tr_hint: '一般',
//     tr_des_s: '有降水注意防雷防风，稍热注意防暑。',
//     co_name: '舒适度指数',
//     co_hint: '较不舒适',
//     co_des_s: '白天有雨，湿度加大，闷热。',
//     pj_name: '啤酒指数',
//     pj_hint: '适宜',
//     pj_des_s: '天气炎热，可适量饮用啤酒，不要过量。',
//     hc_name: '划船指数',
//     hc_hint: '不适宜',
//     hc_des_s: '风力很大，不适宜划船。',
//     gl_name: '太阳镜指数',
//     gl_hint: '不需要',
//     gl_des_s: '白天能见度差不需要佩戴太阳镜',
//     uv_name: '紫外线强度指数',
//     uv_hint: '最弱',
//     uv_des_s: '辐射弱，涂擦SPF8-12防晒护肤品。',
//     wc_name: '风寒指数',
//     wc_hint: '无',
//     wc_des_s: '温度未达到风寒所需的低温，稍作防寒准备即可。',
//     ct_name: '穿衣指数',
//     ct_hint: '热',
//     ct_des_s: '适合穿T恤、短薄外套等夏季服装。',
//     pk_name: '放风筝指数',
//     pk_hint: '不宜',
//     pk_des_s: '天气不好，不适宜放风筝。',
//     ac_name: '空调开启指数',
//     ac_hint: '部分时间开启',
//     ac_des_s: '午后天气炎热可适时开启制冷空调。',
//     dy_name: '钓鱼指数',
//     dy_hint: '不宜',
//     dy_des_s: '风力太大，不适合垂钓。',
//     ls_name: '晾晒指数',
//     ls_hint: '不宜',
//     ls_des_s: '降水可能会淋湿衣物，请选择在室内晾晒。',
//     xc_name: '洗车指数',
//     xc_hint: '不宜',
//     xc_des_s: '有雨，雨水和泥水会弄脏爱车。',
//     xq_name: '心情指数',
//     xq_hint: '较差',
//     xq_des_s: '雨水带来一丝清凉，让烦躁的心绪降温。',
//     zs_name: '中暑指数',
//     zs_hint: '可能有影响',
//     zs_des_s: '对敏感人群来说，今天可能出现中暑的情况，出门时该做的防护还是做起来吧~',
//     jt_name: '交通指数',
//     jt_hint: '一般',
//     jt_des_s: '有降水且路面湿滑，注意保持车距。',
//     yh_name: '约会指数',
//     yh_hint: '不适宜',
//     yh_des_s: '建议在室内约会，免去天气的骚扰。',
//     yd_name: '运动指数',
//     yd_hint: '较不宜',
//     yd_des_s: '有降水，推荐您在室内进行休闲运动。',
//     ag_name: '过敏指数',
//     ag_hint: '不易发',
//     ag_des_s: '除特殊体质，无需担心过敏问题。',
//     mf_name: '美发指数',
//     mf_hint: '一般',
//     mf_des_s: '天热，头皮皮脂分泌多，注意清洁。',
//     ys_name: '雨伞指数',
//     ys_hint: '带伞',
//     ys_des_s: '有降水，短时间出行不必带伞。',
//     fs_name: '防晒指数',
//     fs_hint: '弱',
//     fs_des_s: '涂抹8-12SPF防晒护肤品。',
//     pp_name: '化妆指数',
//     pp_hint: '去油',
//     pp_des_s: '请选用露质面霜打底，水质无油粉底霜。',
//     gz_name: '干燥指数',
//     gz_hint: '非常干燥',
//     gz_des_s: '风速偏大，皮肤极易流失水分，建议使用高保湿型护肤品，适当使用润唇膏，多饮水，减少皮肤暴露在外面积。',
//   },
//   cn: '雨花台',
// }
// var fc = {
//   f: [
//     {
//       fa: '07',
//       fb: '10',
//       fc: '29',
//       fd: '23',
//       fe: '北风',
//       ff: '北风',
//       fg: '3-4级',
//       fh: '5-6级',
//       fk: '8',
//       fl: '8',
//       fm: '999.9',
//       fn: '94',
//       fi: '7\\/30',
//       fj: '今天',
//     },
//     {
//       fa: '09',
//       fb: '08',
//       fc: '26',
//       fd: '23',
//       fe: '北风',
//       ff: '东南风',
//       fg: '5-6级',
//       fh: '4-5级',
//       fk: '8',
//       fl: '3',
//       fm: '100',
//       fn: '94',
//       fi: '7\\/31',
//       fj: '星期四',
//     },
//     {
//       fa: '09',
//       fb: '09',
//       fc: '27',
//       fd: '24',
//       fe: '东南风',
//       ff: '西南风',
//       fg: '4-5级',
//       fh: '4-5级',
//       fk: '3',
//       fl: '5',
//       fm: '100',
//       fn: '88.1',
//       fi: '8\\/1',
//       fj: '星期五',
//     },
//     {
//       fa: '04',
//       fb: '04',
//       fc: '29',
//       fd: '25',
//       fe: '西南风',
//       ff: '西风',
//       fg: '4-5级',
//       fh: '4-5级',
//       fk: '5',
//       fl: '6',
//       fm: '100',
//       fn: '91.4',
//       fi: '8\\/2',
//       fj: '星期六',
//     },
//     {
//       fa: '04',
//       fb: '04',
//       fc: '29',
//       fd: '26',
//       fe: '西风',
//       ff: '西南风',
//       fg: '3-4级',
//       fh: '3-4级',
//       fk: '6',
//       fl: '5',
//       fm: '99.8',
//       fn: '80.4',
//       fi: '8\\/3',
//       fj: '星期日',
//     },
//   ],
// }
