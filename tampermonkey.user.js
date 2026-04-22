// ==UserScript==
// @name         学习通随堂练习自动答题
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动从本地 chaoixng-signin 服务获取随机爬取的日志答案，并自动在页面上点选提交
// @match        *://mobilelearn.chaoxing.com/widget/pcvote/*
// @match        *://mobilelearn.chaoxing.com/widget/vote/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 本地服务端接口地址，请确保端口与您的 serve.ts 运行端口一致 (默认5000)
    const API_URL = 'http://localhost:5000/practice/answer';

    // 延时等待页面DOM渲染完成
    setTimeout(() => {
        console.log('[学习通助手] 正在向本地服务获取随堂练习答案...');
        
        GM_xmlhttpRequest({
            method: 'GET',
            url: API_URL,
            onload: function(response) {
                try {
                    const res = JSON.parse(response.responseText);
                    if (res.code === 200 && res.answer) {
                        const answerText = res.answer.trim();
                        console.log("[学习通助手] 成功获取到答案:", answerText);
                        
                        // 寻找页面上的选项元素 (视页面结构可能需要调整选择器)
                        // 常规的随堂练习可能是 radio/checkbox label 或含有选项内容的 li 标签
                        const optionsElements = document.querySelectorAll('label, .option, .answer, li');
                        let clicked = false;
                        
                        optionsElements.forEach(opt => {
                            const optText = opt.innerText || opt.textContent || '';
                            if (optText.includes(answerText) || answerText.includes(optText.trim())) {
                                opt.click();
                                console.log('[学习通助手] 已自动选中选项:', optText);
                                clicked = true;
                            }
                        });

                        if (clicked) {
                            // 尝试自动点击提交按钮 (此处提供常见提交按钮选择器)
                            setTimeout(() => {
                                const submitBtns = document.querySelectorAll('a.btn-submit, button.submit, .submit-btn, [onclick*="submit"]');
                                if(submitBtns.length > 0) {
                                    // 开启这行代码会自动交卷，如需确认请保留注释
                                    // submitBtns[0].click();
                                    console.log('[学习通助手] 已选择答案，请手动点击提交以确保无误（或在脚本中开启自动提交代码）。');
                                }
                            }, 500);
                        } else {
                            console.log('[学习通助手] 未在页面上找到匹配的答案选项。');
                        }
                    } else {
                        console.log("[学习通助手] 未获取到有效答案:", res.msg);
                    }
                } catch (e) {
                    console.error("[学习通助手] 解析服务响应失败:", e);
                }
            },
            onerror: function(err) {
                console.error("[学习通助手] 请求本地服务失败，请检查服务是否运行在5000端口", err);
            }
        });
    }, 2000); // 2秒延时，可根据电脑和网络速度调整
})();
