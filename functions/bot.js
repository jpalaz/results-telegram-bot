const puppeteer = require('puppeteer-core')
const ejs = require("ejs")
const ws = require("ws")
const zlib = require("zlib")
const { Telegraf, Input } = require('telegraf')
const { message } = require('telegraf/filters')
const chromium = require('@sparticuz/chromium')

const bot = new Telegraf(process.env.BOT_TOKEN);

class SessionType {
    constructor(name, nameUKR, template, id, width) {
        this.nameBLR = name
        this.nameUKR = nameUKR
        this.template = template
        this.id = id
        this.width = width
    }
}

const sessionTypes = {
    q1: new SessionType('КВАЛІФІКАЦЫЯ - 1', 'КВАЛІФІКАЦІЯ - 1', "qualification", "Q1", 3000),
    q2: new SessionType('КВАЛІФІКАЦЫЯ - 2', 'КВАЛІФІКАЦІЯ - 2', "qualification", "Q2", 3000),
    q3: new SessionType('КВАЛІФІКАЦЫЯ', 'КВАЛІФІКАЦІЯ', "qualification", "Q3", 3000),
    sq1: new SessionType('СПРЫНТ КВАЛІФІКАЦЫЯ - 1', 'СПРИНТ КВАЛІФІКАЦІЯ - 1', "qualification", "SQ1", 3000),
    sq2: new SessionType('СПРЫНТ КВАЛІФІКАЦЫЯ - 2', 'СПРИНТ КВАЛІФІКАЦІЯ - 2', "qualification", "SQ2", 3000),
    sq3: new SessionType('СПРЫНТ КВАЛІФІКАЦЫЯ', 'СПРИНТ КВАЛІФІКАЦІЯ', "qualification", "SQ3", 3000),
    race: new SessionType('ГОНКА', 'ГОНКА', "race", "race", 2400),
    sprint: new SessionType('СПРЫНТ', 'СПРИНТ', "race", "sprint", 2400),
    fp1: new SessionType('ВОЛЬНАЯ ПРАКТЫКА 1', 'ПРАКТИКА 1', "practice", "FP1", 2400),
    fp2: new SessionType('ВОЛЬНАЯ ПРАКТЫКА 2', 'ПРАКТИКА 2', "practice", "FP2", 2400),
    fp3: new SessionType('ВОЛЬНАЯ ПРАКТЫКА 3', 'ПРАКТИКА 3', "practice", "FP3", 2400),
};

const sortPosition = (a, b) => {
    const [, aLine] = a;
    const [, bLine] = b;
    const aPos = Number(aLine.Position);
    const bPos = Number(bLine.Position);
    return aPos - bPos;
};

class DriverName {
    constructor(nameBLR, nameUKR, teamId) {
        this.nameBLR = nameBLR
        this.nameUKR = nameUKR
        this.teamId = teamId
    }
}

const DRIVER_NAMES = {
    "1": new DriverName("Макс Верстапен", "Макс Ферстаппен", 1),
    "11": new DriverName("Серхіа Перэс", "Серхіо Перес", 1),
    "63": new DriverName("Джордж Расэл", "Джордж Расселл", 2),
    "44": new DriverName("Льюіс Гэмілтан", "Льюїс Хемілтон", 2),
    "55": new DriverName("Карлас Сайнц", "Карлос Сайнс", 3),
    "16": new DriverName("Шарль Леклер", "Шарль Леклер", 3),
    "38": new DriverName("Олівер Берман", "Олівер Берман", 3),
    "4": new DriverName("Ланда Норыс", "Ландо Норріс", 4),
    "81": new DriverName("Оскар Піястры", "Оскар Піастрі", 4),
    "14": new DriverName("Фернанда Алонса", "Фернандо Алонсо", 5),
    "18": new DriverName("Лэнс Строл", "Ленс Стролл", 5),
    "10": new DriverName("П'ер Гаслі", "П'єр Гаслі", 6),
    "31": new DriverName("Эстэбан Акон", "Естебан Окон", 6),
    "23": new DriverName("Алекс Албан", "Алекс Албон", 7),
    "2": new DriverName("Логан Сарджэнт", "Логан Сарджент", 7),
    "3": new DriverName("Даніэль Рык'ярда", "Даніель Ріккардо", 8),
    "22": new DriverName("Юкі Цунода", "Юкі Цунода", 8),
    "??": new DriverName("Аюму Іваса 🔁", "Аюму Іваса 🔁", 8),
    "77": new DriverName("Вальтэры Ботас", "Вальтері Боттас", 9),
    "24": new DriverName("Гуанью Чжоў", "Гуанью Чжоу", 9),
    "27": new DriverName("Ніка Хюлкенберг", "Ніко Хюлькенберг", 10),
    "20": new DriverName("Кевін Магнусэн", "Кевін Магнуссен", 10),
}

const POINTS = {
    1: 25, 2: 18, 3: 15, 4: 12, 5: 10,
    6: 8, 7: 6, 8: 4, 9: 2, 10: 1
}

class RoundInfo2024 {
    constructor(gpNameBLR, gpNameUKR, flag, time) {
        this.gpNameBLR = gpNameBLR
        this.gpNameUKR = gpNameUKR
        this.flag = flag
        this.time = time
    }
}

const rounds = [
    new RoundInfo2024('ГП Аўстраліі', "ГП Австралії", "au", 1711058400),
    new RoundInfo2024("ГП Японіі", "ГП Японії", "jp", 1712248195),
    new RoundInfo2024("ГП Кітая", "ГП ", "cn", 1713474000),
    new RoundInfo2024("ГП Маямі", "ГП ", "us", 1714683600)
]

function extractCurrentRound() {
    return rounds.findLast((it) => it.time < (Date.now() / 1000))
}

let state = {};

function translateLappedText(gap) {
    const indexOfL = gap.indexOf("L")
    if (indexOfL !== -1) {
        return gap.substring(0, indexOfL) + "К"
    }
    return gap
}

function mapSourceDataToDriver(type, it, i, qualiSegment) {
    const knownDriver = DRIVER_NAMES[it[0]]
    const driver = knownDriver != null ? knownDriver : DRIVER_NAMES["??"]
    const driverData = {
        nameBLR: driver.nameBLR,
        nameUKR: driver.nameUKR,
        teamId: driver.teamId
    }
    switch (type) {
        case "practice":
            driverData.bestLapTime = it[1].BestLapTime?.Value
            driverData.gap = it[1].TimeDiffToFastest
            driverData.laps = it[1].NumberOfLaps
            break
        case "qualification":
            driverData.bestLapTimeQ1 = it[1].BestLapTimes[0]?.Value
            driverData.bestLapTimeQ2 = it[1].BestLapTimes[1]?.Value
            driverData.bestLapTimeQ3 = it[1].BestLapTimes[2]?.Value
            if (i < 15) {
                driverData.gap = it[1].Stats[qualiSegment]?.TimeDiffToFastest
            }
            driverData.laps = it[1].NumberOfLaps
            break
        case "race":
            if (it[1].Stopped) {
                driverData.gapToLeaderBLR = "СЫХОД"
                driverData.gapToLeaderUKR = "СХІД"
                driverData.timeToDriverAhead = ""
            } else {
                const gap = translateLappedText(it[1].GapToLeader)
                driverData.gapToLeaderBLR = gap
                driverData.gapToLeaderUKR = gap
                driverData.timeToDriverAhead = translateLappedText(it[1].IntervalToPositionAhead?.Value)
            }
            driverData.isFL = false
            driverData.fastClass = ""
            driverData.points = (i < 10) ? POINTS[(i + 1)] : 0
    }
    return driverData
}

function prepareData(type, qualiSegment = 0) {
    let fastestLap = "9:99.999"
    let fastestPosition = 0
    const timingData = Object.assign({}, state.TimingData.Lines)
    const lines = Object.entries(timingData).sort(sortPosition)
        .map((it, i) => {
            const driverData = mapSourceDataToDriver(type, it, i, qualiSegment)
            if (type === "race") {
                const currentFastLap = it[1].BestLapTime?.Value
                if (!it[1].Stopped && currentFastLap !== "" && currentFastLap < fastestLap) {
                    fastestLap = currentFastLap
                    fastestPosition = i
                }
            }
            return driverData;
        })
    lines[fastestPosition].isFL = true
    lines[fastestPosition].fastClass = "fastLap"
    if (fastestPosition < 10) {
        lines[fastestPosition].points += 1
    }

    console.log("fastest lap: " + fastestLap + ", fastest: " + lines[fastestPosition].nameBLR)
    console.log(lines[0])
    const currentRound = extractCurrentRound()
    return {
        drivers: lines,
        grandPrixNameBLR: currentRound.gpNameBLR,
        grandPrixNameUKR: currentRound.gpNameUKR,
        grandPrixFlag: currentRound.flag
    }
}

async function convert(sessionType, requestBody, qualiSegment = 0) {
    chromium.setHeadlessMode = true
    const browser = await puppeteer.launch(
        {
            args: chromium.args,
            defaultViewport: { width: 2700, height: 2700 },
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        })
    const page = await browser.newPage()

    console.log("Мова: " + requestBody.language)
    const sessionData = prepareData(sessionType.template, qualiSegment);
    sessionData.sessionNameBLR = sessionType.nameBLR
    sessionData.sessionNameUKR = sessionType.nameUKR
    let templateFolder = "functions/templates"
    if (requestBody.language === "UKR") {
        templateFolder += "-ukr"
    }
    const html = await ejs.renderFile(templateFolder + "/" + sessionType.template + ".ejs", sessionData)
    await page.setContent(html, {timeout: 0, waitUntil:'networkidle2'});
    await page.setViewport({ width: sessionType.width, height: 2700 })
    const client = await page.target().createCDPSession();
    await client.send('Page.enable');
    await client.send('Page.setFontSizes', {
        fontSizes: {
            standard: 30,
            fixed: 50
        }
    })

    const screenshotName = "F1 " + timeConverter(Date.now()) + " "
        + sessionType.id + " - " + requestBody.language + ".png"
    try {
        // Capture screenshot and save it in the current folder:
//        const screenshotPath = "./screenshots/" + screenshotName
//        await page.screenshot({path: screenshotPath })
//        return screenshotPath
        const screenshotBuffer = await page.screenshot()
        return [screenshotBuffer, screenshotName]
    } catch (err) {
        console.log(`Error: ${err.message}`)
    } finally {
        await browser.close();
        console.log(`Screenshot has been captured successfully`)
    }
}

function withLeadingZero(number) {
    return number < 10 ? ("0" + number) : ("" + number); 
}

function timeConverter(UNIX_timestamp) {
    const a = new Date(UNIX_timestamp);
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const year = a.getFullYear();
    const month = months[a.getMonth()];
    const date = a.getDate();
    const hour = a.getHours();
    const min = a.getMinutes();
    const sec = a.getSeconds();
    return year + '-' + month + '-' + withLeadingZero(date) + ' '
        + withLeadingZero(hour) + '-'  + withLeadingZero(min) + '-'  + withLeadingZero(sec)
}

function sendImage(res, png) {
    return res.contentType("image/png").send(png);
}

const signalrUrl = "livetiming.formula1.com/signalr";
const signalrHub = "Streaming";

const socketFreq = 250;
const retryFreq = 10000;

let messageCount = 0;
let emptyMessageCount = 0;

const deepObjectMerge = (original = {}, modifier) => {
    if (!modifier) return original;
    const copy = { ...original };
    for (const [key, value] of Object.entries(modifier)) {
        const valueIsObject =
      typeof value === "object" && !Array.isArray(value) && value !== null;
        if (valueIsObject && !!Object.keys(value).length) {
            copy[key] = deepObjectMerge(copy[key], value);
        } else {
            copy[key] = value;
        }
    }
    return copy;
};

const parseCompressed = (data) =>
  JSON.parse(zlib.inflateRawSync(Buffer.from(data, "base64")).toString());


const updateState = (data) => {
    try {
        const parsed = JSON.parse(data.toString());

        if (!Object.keys(parsed).length) emptyMessageCount++;
        else emptyMessageCount = 0;

//        if (emptyMessageCount > 15) {
//            console.log ("Cleaning state - 15 empty messages")
//            state = {};
//            messageCount = 0;
//        }

        if (Array.isArray(parsed.M)) {
            for (const message of parsed.M) {
                if (message.M === "feed") {
                    messageCount++;

                    let [field, value] = message.A;

                    if (field === "CarData.z" || field === "Position.z") {
                        const [parsedField] = field.split(".");
                        field = parsedField;
                        value = parseCompressed(value);
                    }

                    state = deepObjectMerge(state, { [field]: value });
                }
            }
        } else if (Object.keys(parsed.R ?? {}).length && parsed.I === "1") {
            messageCount++;

            if (parsed.R["CarData.z"])
                parsed.R["CarData"] = parseCompressed(parsed.R["CarData.z"]);

            if (parsed.R["Position.z"])
                parsed.R["Position"] = parseCompressed(parsed.R["Position.z"]);

            state = deepObjectMerge(state, parsed.R);
        }
    } catch (e) {
        console.error(`could not update data: ${e}`);
    }
};

let socket = {}

const setupStream = async (wss) => {
    console.log(`[${signalrUrl}] Connecting to live timing stream`);

    const hub = encodeURIComponent(JSON.stringify([{ name: signalrHub }]));
    const negotiation = await fetch(
        `https://${signalrUrl}/negotiate?connectionData=${hub}&clientProtocol=1.5`
        );
    const cookie =
    negotiation.headers.get("Set-Cookie") ??
    negotiation.headers.get("set-cookie");
    const { ConnectionToken } = await negotiation.json();

    if (cookie && ConnectionToken) {
        console.log(`[${signalrUrl}] HTTP negotiation complete`);

        socket = new ws(
            `wss://${signalrUrl}/connect?clientProtocol=1.5&transport=webSockets&connectionToken=${encodeURIComponent(
                ConnectionToken
                )}&connectionData=${hub}`,
            [],
            {
                headers: {
                    "User-Agent": "BestHTTP",
                    "Accept-Encoding": "gzip,identity",
                    Cookie: cookie,
                },
            }
            );

        socket.on("open", () => {
            console.log(`[${signalrUrl}] WebSocket open`);

            state = {};
            messageCount = 0;
            emptyMessageCount = {};

            socket.send(
                JSON.stringify({
                    H: signalrHub,
                    M: "Subscribe",
                    A: [
                        [
                            "Heartbeat",
                            //                            "CarData.z",
                            //                            "Position.z",
                            "ExtrapolatedClock",
                            "TimingStats",
                            "TimingAppData",
                            //                            "WeatherData",
                            "TrackStatus",
                            //                            "DriverList",
                            //                            "RaceControlMessages",
                            "SessionInfo",
                            "SessionData",
                            "LapCount",
                            "TimingData",
                            //                            "TeamRadio",
                            ],
                        ],
                    I: 1,
                })
                );
        });

        socket.on("message", (data) => {
            updateState(data);
        });

        socket.on("error", () => {
            console.log("socket error");
            socket.close();
        });

        socket.on("close", () => {
            console.log("socket close");
            state = {};
            messageCount = 0;
            emptyMessageCount = {};

            setTimeout(() => {
                setupStream(wss);
            }, retryFreq);
        });
    } else {
        console.log(
            `[${signalrUrl}] HTTP negotiation failed. Is there a live session?`
            );
        state = {};
        messageCount = 0;

        setTimeout(() => {
            setupStream(wss);
            }, retryFreq);
    }
};

const wss = new ws.WebSocketServer({ noServer: true });

function sendImageToUser(ctx) {
    return screenshot => ctx.replyWithDocument({source: screenshot[0], filename: screenshot[1]});
}

bot.command('race', async (ctx) => {
    await convert(sessionTypes.race, {language: "BLR"})
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.race, {language: "UKR"})
        .then(sendImageToUser(ctx))
})

bot.command('fp1', async (ctx) => {
    await convert(sessionTypes.fp1, {language: "BLR"})
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.fp1, {language: "UKR"})
        .then(sendImageToUser(ctx))
})

bot.command('fp2', async (ctx) => {
    await convert(sessionTypes.fp2, {language: "BLR"})
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.fp2, {language: "UKR"})
        .then(sendImageToUser(ctx))
})

bot.command('fp3', async (ctx) => {
    await convert(sessionTypes.fp3, {language: "BLR"})
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.fp3, {language: "UKR"})
        .then(sendImageToUser(ctx))
})

bot.command('q1', async (ctx) => {
    await convert(sessionTypes.q1, {language: "BLR"}, 0)
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.q1, {language: "UKR"}, 0)
        .then(sendImageToUser(ctx))
})

bot.command('q2', async (ctx) => {
    await convert(sessionTypes.q2, {language: "BLR"}, 1)
        .then(sendImageToUser(ctx))
    await convert(sessionTypes.q2, {language: "UKR"}, 1)
        .then(sendImageToUser(ctx))
})

async function createAndSendScreenshots(ctx, sessionType, qualiSegment = 0) {
    await convert(sessionType, {language: "BLR"}, qualiSegment)
            .then(sendImageToUser(ctx))
    await convert(sessionType, {language: "UKR"}, qualiSegment)
            .then(sendImageToUser(ctx))
}

bot.command('q3', async (ctx) => {
    await createAndSendScreenshots(ctx, sessionTypes.q3, 2);
})

bot.command('reconnect', async (ctx) => {
    await socket.close()
    ctx.reply("Websocket connection restarted")
})

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

// Assume we have an active session after 5 messages
let active;

async function startStream() {
    await setupStream(wss);

    setInterval(() => {
            active = messageCount > 5;
            wss.clients.forEach((s) => {
                if (s.readyState === ws.OPEN) {
                    s.send(active ? JSON.stringify(state) : "{}", {
                        binary: false,
                    });
                }
            });
        }, socketFreq);
}

exports.handler = async event => {
    try {
        await bot.handleUpdate(JSON.parse(event.body))
        return { statusCode: 200, body: "" }
    } catch (e) {
        console.error("error in handler:", e)
        return { statusCode: 400, body: "This endpoint is meant for bot and telegram communication" }
    }
}

console.log(`Starting streaming...`)
startStream()
    .then(_ => {
        console.log(`Starting bot...`)
        bot.launch()
            .then(_ => console.log(`Results Bot started`))
    })
