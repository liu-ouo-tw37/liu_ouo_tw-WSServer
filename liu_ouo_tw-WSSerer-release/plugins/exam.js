const fs = require("fs");
const fsPromises = require("fs").promises;

function initExamPlugin(server) {
    const exams = new Map();
    const examWakeWord = server.examWakeWord || "-exam?";
    const answerWakeWord = server.answerWakeWord || "-answer?";
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const examRegex = new RegExp(`^${escapeRegExp(examWakeWord)}\\s*(.*)$`);
    const answerRegex = new RegExp(`^${escapeRegExp(answerWakeWord)}\\s*(.+)$`);

    const translateType = (type) => {
        const types = {
        "single": "單選題",
        "multiple": "多選題",
        "math": "填充題"
        };
        return types[type] || "一般題型";
    };

    const getSimilarity = (s1, s2) => {
        if (!s1 || !s2) return 0;
        const longer = s1.length >= s2.length ? s1 : s2;
        const shorter = s1.length < s2.length ? s1 : s2;
        const longerLength = longer.length;
        if (longerLength === 0) return 1.0;
        
        const costs = [];
        for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
            costs[j] = j;
            } else {
            if (j > 0) {
                let newValue = costs[j - 1];
                if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
        }
        return (longerLength - costs[shorter.length]) / longerLength;
    };

    const getPlayerStats = (playerName) => {
        const filePath = server.statsPath;
        if (!fs.existsSync(filePath)) return { answer_ids: [], mastery: {} };
        const allStats = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return allStats[playerName] || { answer_ids: [], mastery: {} };
    };

    const savePlayerStats = async (playerName, stats) => {
        const filePath = server.statsPath;
        let allStats = {};
        try {
        const data = await fsPromises.readFile(filePath, "utf-8");
        allStats = JSON.parse(data);
        } catch (err) {
        if (err.code !== 'ENOENT') {
            server.emit("log", `[系統] 讀取玩家統計失敗：${err.message}`);
        }
        }
        allStats[playerName] = stats;
        await fsPromises.writeFile(filePath, JSON.stringify(allStats, null, 2), "utf-8");
    };

    const sendCurrentQuestion = (playerName) => {
        const exam = exams.get(playerName);
        if (!exam) return;

        const q = exam.questions[exam.currentIndex];
        setTimeout(() => {
        server.sendPrivateMessage(playerName, `§f--------------------------------`);
        server.sendPrivateMessage(playerName, `§e第 ${exam.currentIndex + 1} 題 (${translateType(q.type)})`);
        server.sendPrivateMessage(playerName, `§a主題：§7${q.topic || "一般"}`);
        server.sendPrivateMessage(playerName, `§f${q.question}`);

        if (q.options && q.options.length > 0) {
            q.options.forEach((opt, i) => {
            setTimeout(() => server.sendPrivateMessage(playerName, `§7${opt}`), i * 50);
            });
        }
        }, 100);
    };

    const normalizeCommonAnswer = (value) => {
        return String(value ?? "")
            .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/\u3000/g, " ")
            .replace(/[−–—]/g, "-")
            .replace(/[×＊]/g, "*")
            .replace(/÷/g, "/")
            .replace(/[，、]/g, ",")
            .replace(/：/g, ":")
            .replace(/\s+/g, "")
            .toUpperCase();
    };

    const normalizeChoiceAnswer = (value) => {
        return normalizeCommonAnswer(value)
            .replace(/[^A-Z]/g, "")
            .split("")
            .sort()
            .join("");
    };

    const trimOuterParens = (value) => {
        if (/^\(.+\)$/.test(value)) return value.slice(1, -1);
        return value;
    };

    const parseSimpleNumber = (value) => {
        const text = trimOuterParens(normalizeCommonAnswer(value));
        if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return Number(text);

        const fraction = text.match(/^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/);
        if (!fraction) return null;

        const numerator = Number(fraction[1]);
        const denominator = Number(fraction[2]);
        if (denominator === 0) return null;

        return numerator / denominator;
    };

    const numbersEqual = (left, right) => {
        const leftNumber = parseSimpleNumber(left);
        const rightNumber = parseSimpleNumber(right);
        return leftNumber !== null
            && rightNumber !== null
            && Math.abs(leftNumber - rightNumber) < 1e-9;
    };

    const mathAnswersEqual = (userAnswer, rawAnswer) => {
        const user = normalizeCommonAnswer(userAnswer);
        const correct = normalizeCommonAnswer(Array.isArray(rawAnswer) ? rawAnswer.join("") : rawAnswer);

        if (user === correct) return true;
        if (trimOuterParens(user) === trimOuterParens(correct)) return true;
        if (numbersEqual(user, correct)) return true;

        const userParts = trimOuterParens(user).split(",");
        const correctParts = trimOuterParens(correct).split(",");
        if (userParts.length > 1 && userParts.length === correctParts.length) {
            return userParts.every((part, index) => {
                return part === correctParts[index] || numbersEqual(part, correctParts[index]);
            });
        }

        return false;
    };

    const checkAnswer = (playerName, userAnswer) => {
        const exam = exams.get(playerName);
        if (!exam) return;
        
        const currentQ = exam.questions[exam.currentIndex];
        const rawAnswer = currentQ.answer !== undefined ? currentQ.answer : currentQ.correctAnswer;
        let isRight = false;

        if (currentQ.type === "multiple") {
            const targetAnsStr = Array.isArray(rawAnswer)
                ? rawAnswer.map(a => normalizeChoiceAnswer(a)).sort().join("")
                : normalizeChoiceAnswer(rawAnswer);
            
            isRight = normalizeChoiceAnswer(userAnswer) === targetAnsStr;
        }else if (currentQ.type === "math") {
            isRight = mathAnswersEqual(userAnswer, rawAnswer);
        } else {
            isRight = normalizeChoiceAnswer(userAnswer) === normalizeChoiceAnswer(rawAnswer);
        }

        const correct = Array.isArray(rawAnswer) ? rawAnswer.join("") : String(rawAnswer);
        const stats = getPlayerStats(playerName);
        if (!stats.mastery[currentQ.id]) {
        stats.mastery[currentQ.id] = { correct_count: 0, last_time: 0 };
        }

        if (isRight) {
        stats.mastery[currentQ.id].correct_count++;
        exam.score++;
        server.sendPrivateMessage(playerName, "§a§l✔ 回答正確");
        } else {
        stats.mastery[currentQ.id].correct_count = Math.max(0, stats.mastery[currentQ.id].correct_count - 1);
        server.sendPrivateMessage(playerName, `§c§l✘ 回答錯誤  正確答案為§6${correct}`);
        }

        stats.mastery[currentQ.id].last_time = Date.now();
        savePlayerStats(playerName, stats);

        exam.currentIndex++;
        if (exam.currentIndex < 6) {
        setTimeout(() => sendCurrentQuestion(playerName), 1000);
        } else {
        const totalScore = exam.score;
        server.runCommand(`playsound random.screenshot "${playerName}"`);
        server.sendPrivateMessage(playerName, `§6§l[測驗結束] §e總共答對§a${totalScore} §e/ 6題！`);
        exams.delete(playerName);
        }
    };

    const mathQuestion = async (playerName, topic) => {
        try {
        if (exams.has(playerName)) {
            server.sendPrivateMessage(playerName, "§c[考試系統] 你已經在考試中，請完成後再重新開始。");
            return;
        }
        
        // 讀取題庫
        const allData = JSON.parse(fs.readFileSync(server.mathDbPath, "utf-8"));

        let pool = allData;
        if (topic !== "高中數學") {
            pool = allData.filter(q => q.topic === topic);
        }
        if (pool.length < 6) {
            if (topic !== "高中數學") {
            server.sendPrivateMessage(playerName, `§7主題「${topic}」題目較少，已混合其他題目`);
            }
            pool = allData;
        }
        const playerStats = getPlayerStats(playerName);

        // 計算遺忘曲線
        const weightedData = pool.map(q => {
            let weight = 1.0;
            const record = playerStats.mastery[q.id];

            if (record) {
            const hoursSinceLast = (Date.now() - record.last_time) / (1000 * 60 * 60);
            weight = (1 / (record.correct_count + 1)) * (1 + hoursSinceLast / 168);
            }
            return { ...q, currentWeight: weight };
        });

        const sampleByWeight = (arr, n) => {
            if (arr.length <= n) return arr;
            return arr
            .sort((a, b) => b.currentWeight - a.currentWeight)
            .slice(0, n * 2)
            .sort(() => 0.5 - Math.random())
            .slice(0, n);
        };

        const singles = weightedData.filter(q => q.type === "single");
        const multiples = weightedData.filter(q => q.type === "multiple");
        const maths = weightedData.filter(q => q.type === "math");
        
        const examSet = [
            ...sampleByWeight(singles, 2),
            ...sampleByWeight(multiples, 2),
            ...sampleByWeight(maths, 2)
        ];
        
        if (examSet.length < 6) {
            server.sendPrivateMessage(playerName, "§c[考試系統] 題庫題目不足，無法組成6題測驗");
            return;
        }
        
        exams.set(playerName, {
            questions: examSet,
            currentIndex: 0,
            score: 0
        });

        server.sendPrivateMessage(playerName, `§e[考試系統] 測驗開始 共六題 輸入-answer?作答`);
        sendCurrentQuestion(playerName);
        } catch (err) {
        console.error(err);
        server.sendPrivateMessage(playerName, "§c題庫讀取失敗。");
        }
    };


    server.on("playerMessage", async (sender, message) => {
        const examMatch = message.match(examRegex);
        if (examMatch) {
        const inputTopic = examMatch[1].trim();
        const defaultTopic = "高中數學";
        
        if (!inputTopic) {
            await mathQuestion(sender, defaultTopic);
            return;
        }
        
        if (server.allMathTopics && server.allMathTopics.includes(inputTopic)) {
            await mathQuestion(sender, inputTopic);
        } else {
            let bestMatch = null;
            let highestSimilarity = 0;
            
            const topics = server.allMathTopics || [];
            topics.forEach(t => {
            const similarity = getSimilarity(inputTopic, t);
            if (similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = t;
            }
            });
            
            if (bestMatch && highestSimilarity > 0.4) {
            server.sendPrivateMessage(sender, `§c[考試系統] 找不到主題「${inputTopic}」`);
            server.sendPrivateMessage(sender, `§e您是不是要找：${bestMatch}？`);
            server.sendPrivateMessage(sender, `§7輸入 ${examWakeWord}${bestMatch} 即可開始`);
            } else {
            server.sendPrivateMessage(sender, `§c[考試系統] 找不到主題「${inputTopic}」，改為練習全範圍`);
            await mathQuestion(sender, defaultTopic);
            }
        }
        return;
        }

        const answerMatch = message.match(answerRegex);
            if (answerMatch) {
            if (!exams.has(sender)) {
                server.sendPrivateMessage(sender, `§c[考試系統] 目前你沒有在進行的考試 請輸入 ${examWakeWord}...`);
                return;
            }
            const userAnswer = answerMatch[1].trim().toUpperCase();
            checkAnswer(sender, userAnswer);
            return;
        }
    });
}

module.exports = initExamPlugin;
