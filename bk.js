// ==UserScript==
// @name         NicoHLS M3U8+Key 下載工具 Plus
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  抓取 m3u8、key 並產生 N_m3u8DL 指令
// @author       wusp
// @match        https://live.nicovideo.jp/watch/*
// @run-at       document-start
// @grant        GM_download unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    const info = {
        audio: { m3u8Url: "", m3u8Content: "", keyUrl: "", keyData: null },
        video: { m3u8Url: "", m3u8Content: "", keyUrl: "", keyData: null },
        id: "",
        title: "",
        ivAudio: "",
        ivVideo: ""
    };

    const saveBlob = (filename, data) => {
        const blob = new Blob([data]);
        GM_download({ url: URL.createObjectURL(blob), name: filename });
    };

    const getIVFromM3U8 = (m3u8Content) => {
        const match = m3u8Content.match(/#EXT-X-KEY:METHOD=AES-128,URI=".*?",IV=0x([0-9a-fA-F]+)/);
        return match ? match[1] : "";
    };

    function addXMLRequestCallback(callback) {
        var oldSend;
        if (XMLHttpRequest.callbacks) {
            XMLHttpRequest.callbacks.push(callback);
        } else {
            XMLHttpRequest.callbacks = [callback];
            oldSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function () {
                for (let i = 0; i < XMLHttpRequest.callbacks.length; i++) {
                    XMLHttpRequest.callbacks[i](this);
                }
                oldSend.apply(this, arguments);
            };
        }
    }

    function getVideoIdFromURL() {
        const match = location.href.match(/\/watch\/(\w+)/);
        return match ? match[1] : "unknownID";
    }

    function getTitleFromJsonLd() {
        const el = document.querySelector('script[type="application/ld+json"]');
        if (el) {
            try {
                const data = JSON.parse(el.textContent);
                return data.name || "unknownTitle";
            } catch (e) {
                console.warn("解析 ld+json 錯誤：", e);
            }
        }
        return "unknownTitle";
    }

    function checkIfReadyToDownload() {
        if (
            info.audio.m3u8Content && info.audio.keyData &&
            info.video.m3u8Content && info.video.keyData &&
            info.title && info.id
        ) {
            const filename = `${info.id}_${info.title}`.replace(/[\\/:*?"<>|]/g, '_');

            info.ivAudio = getIVFromM3U8(info.audio.m3u8Content);
            info.ivVideo = getIVFromM3U8(info.video.m3u8Content);

            saveBlob(`audio.m3u8`, info.audio.m3u8Content);
            saveBlob(`video.m3u8`, info.video.m3u8Content);
            saveBlob(`audio.key`, info.audio.keyData);
            saveBlob(`video.key`, info.video.keyData);

            const cmdAudio = `N_m3u8DL-CLI_v3.0.2.exe audio.m3u8 --saveName "${filename}_audio" --useKeyFile audio.key --useKeyIV ${info.ivAudio}`;
            const cmdVideo = `N_m3u8DL-CLI_v3.0.2.exe video.m3u8 --saveName "${filename}_video" --useKeyFile video.key --useKeyIV ${info.ivVideo}`;

            console.log("✅ 音訊下載指令：", cmdAudio);
            console.log("✅ 視訊下載指令：", cmdVideo);
            alert("🎉 m3u8 與 key 抓取完成，指令已輸出至 Console！");
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        info.id = getVideoIdFromURL();
        info.title = getTitleFromJsonLd();
        console.log("🎥 影片ID：", info.id);
        console.log("📌 標題：", info.title);
    });

    addXMLRequestCallback(
        function (xhr) {
            xhr.addEventListener("load", function () {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    const url = xhr.responseURL;
                    const response = xhr.response;

                    if (url.includes('.m3u8')) {
                        const text = new TextDecoder("utf-8").decode(response);
                        if (url.includes('main-audio')) {
                            info.audio.m3u8Url = url;
                            info.audio.m3u8Content = text;
                            console.log("🎧 抓到音訊 m3u8");
                        }
                        if (url.includes('main-video')) {
                            info.video.m3u8Url = url;
                            info.video.m3u8Content = text;
                            console.log("🎞️ 抓到視訊 m3u8");
                        }
                    }

                    if (url.includes('.key')) {
                        if (url.includes('main-audio')) {
                            info.audio.keyUrl = url;
                            info.audio.keyData = response;
                            console.log("🔑 抓到音訊 key");
                        }
                        if (url.includes('main-video')) {
                            info.video.keyUrl = url;
                            info.video.keyData = response;
                            console.log("🔑 抓到視訊 key");
                        }
                    }

                    checkIfReadyToDownload();
                }
            });

            xhr.responseType = "arraybuffer";
        });
})();
