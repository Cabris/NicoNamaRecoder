// ==UserScript==
// @name         NicoHLS M3U8+Key 下載工具
// @run-at    document-start
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       wusp/christ/chatGPT
// @match        https://live.nicovideo.jp/watch/*
// @exclude
// @require      http://code.jquery.com/jquery-1.11.0.min.js
// @grant        unsafeWindow
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    const info = {
        audio: { m3u8Url: "", m3u8Content: "", keyUrl: "", keyData: null },
        video: { m3u8Url: "", m3u8Content: "", keyUrl: "", keyData: null },
        id: "",
        title: "",
        ivAudio: "",
        ivVideo: "",
        cmdReady: false
    };

    const saveBlob = (filename, data) => {
        const blob = new Blob([data]);
        GM_download({ url: URL.createObjectURL(blob), name: filename });
    };

    const getIVFromM3U8 = (m3u8Content) => {
        const match = m3u8Content.match(/#EXT-X-KEY:METHOD=AES-128,URI=".*?",IV=0x([0-9a-fA-F]+)/);
        return match ? match[1] : "";
    };

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
            info.cmdReady = true;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        info.id = getVideoIdFromURL();
        info.title = getTitleFromJsonLd();
        console.log("🎥 影片ID：", info.id);
        console.log("📌 標題：", info.title);
    });

    $(() => {
        function addXMLRequestCallback(callback) {
            var oldSend, i;
            if (XMLHttpRequest.callbacks) {
                XMLHttpRequest.callbacks.push(callback);
            } else {
                // create a callback queue
                XMLHttpRequest.callbacks = [callback];
                oldSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.send = function () {
                    for (i = 0; i < XMLHttpRequest.callbacks.length; i++) {
                        XMLHttpRequest.callbacks[i](this);
                    }
                    oldSend.apply(this, arguments);
                }
            }
        }

        function callbackFun(xhr) {
            xhr.addEventListener("load", function () {
                if (xhr.readyState == 4 && xhr.status == 200) {
                    const url = xhr.responseURL;
                    const response = xhr.response;
                    if (url.includes('.m3u8')) {
                        const text = response;
                        //console.log("m3u8 response: " + response);
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
                            console.log("🔑 抓到音訊 key ");
                        }
                        if (url.includes('main-video')) {
                            info.video.keyUrl = url;
                            info.video.keyData = response;
                            console.log("🔑 抓到視訊 key");
                        }
                    }
                    if (!info.cmdReady)
                        checkIfReadyToDownload();
                }
            });
        }


        function createSaveButton() {
            const btn = document.createElement('button');
            btn.textContent = '儲存影片資訊';
            Object.assign(btn.style, {
                position: 'fixed',
                top: '100px',
                right: '20px',
                zIndex: 9999,
                padding: '10px 15px',
                fontSize: '14px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
            });

            btn.onclick = () => {
                if (!info.cmdReady) {
                    alert('尚未偵測到 m3u8 或 key 資訊');
                    return;
                }

                const filename = `${info.id}_${info.title}`.replace(/[\\/:*?"<>|]/g, '_');
                console.log("checkIfReadyToDownload: filename: " + filename);
                info.ivAudio = '0x' + getIVFromM3U8(info.audio.m3u8Content);
                info.ivVideo = '0x' + getIVFromM3U8(info.video.m3u8Content);
                console.log("✅ ivAudio：", info.ivAudio);
                console.log("✅ ivVideo：", info.ivVideo);

                const m3u8NameA = `${info.id}_audio.m3u8`;
                const m3u8NameV = `${info.id}_video.m3u8`;
                const keyNameA = `${info.id}_audio.key`;
                const keyNameV = `${info.id}_video.key`;

                let powerShellCMD =
`
$CurtPath = Get-Location
$Path = Join-Path -Path $CurtPath -ChildPath "${info.id}"
New-Item $Path -ItemType Directory
Write-Host "下載目錄: " $Path
$Path_m3u8 = Join-Path -Path $CurtPath -ChildPath "${m3u8NameA}"
$Path_key = Join-Path -Path $CurtPath -ChildPath "${keyNameA}"
$IV = "${info.ivAudio}"
Write-Host "音訊m3u8路徑: " $Path_m3u8
Write-Host "音訊key路徑: " $Path_key
N_m3u8DL-CLI_v3.0.2 $Path_m3u8 --saveName "${filename}_audio" --useKeyFile $Path_key --useKeyIV $IV --workDir $Path --maxThreads "2" --minThreads "1"

$Path_m3u8 = Join-Path -Path $CurtPath -ChildPath "${m3u8NameV}"
$Path_key = Join-Path -Path $CurtPath -ChildPath "${keyNameV}"
$IV = "${info.ivVideo}"
Write-Host "視訊m3u8路徑: " $Path_m3u8
Write-Host "視訊key路徑: " $Path_key
N_m3u8DL-CLI_v3.0.2 $Path_m3u8 --saveName "${filename}_video" --useKeyFile $Path_key --useKeyIV $IV --workDir $Path --maxThreads "2" --minThreads "1"
Write-Host "音訊視訊完成下載"

`

                saveBlob(m3u8NameA, info.audio.m3u8Content);
                saveBlob(m3u8NameV, info.video.m3u8Content);
                saveBlob(keyNameA, info.audio.keyData);
                saveBlob(keyNameV, info.video.keyData);
                saveBlob(`${filename}.txt`,powerShellCMD);
            };

            document.body.appendChild(btn);
        }

        // 等待頁面加載後插入按鈕
        window.addEventListener('load', () => {
            setTimeout(createSaveButton, 1500);
        });

        // e.g.
        addXMLRequestCallback(callbackFun);

    })
})();
