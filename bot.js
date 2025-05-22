require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const { loadNextReel } = require('./utils');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    const page = await browser.newPage();

    const username = process.env.IG_USERNAME;
    const password = process.env.IG_PASSWORD;

    // Step 1: Log in

    const cookiesPath = './session/cookies.json';
    const localStoragePath = './session/localStorage.json';

    let cookies = [];
    if (fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0) {
        try {
            cookies = JSON.parse(fs.readFileSync(cookiesPath));
            await page.setCookie(...cookies);
            await page.goto('https://www.instagram.com', { waitUntil: 'networkidle2' });

            let localStorageData = {};
            if (fs.existsSync(localStoragePath) && fs.statSync(localStoragePath).size > 0) {
                try {
                    localStorageData = JSON.parse(fs.readFileSync(localStoragePath));
                } catch (err) {
                    console.error('❌ Failed to parse localStorage.json:', err.message);
                    fs.unlinkSync(localStoragePath);
                }
            }
            await page.evaluate(data => {
                for (let key in data) {
                    localStorage.setItem(key, data[key]);
                }
            }, localStorageData);

            await page.reload({ waitUntil: 'networkidle2' });

            console.log('Session restored from saved cookies and localStorage');
        } catch (err) {
            console.error('❌ Failed to parse cookies.json:', err.message);
            // Optionally delete corrupt file and force login again
            fs.unlinkSync(cookiesPath);
        }
    } else {
        console.log('No valid cookies found. Skipping session restore.');
        console.log('No saved session found, logging in...');
        await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });
        await page.waitForSelector('input[name="username"]');
        await page.type('input[name="username"]', username, { delay: 100 });
        await page.type('input[name="password"]', password, { delay: 100 });
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // Skip save info and notifications
        try {
            await page.waitForSelector('button:has-text("Not Now")', { timeout: 10000 });
            await page.click('button:has-text("Not Now")');
        } catch { }

        // After successful login
        const cookies = await page.cookies();
        fs.writeFileSync('./session/cookies.json', JSON.stringify(cookies, null, 2));

        // Save localStorage
        const localStorageData = await page.evaluate(() => {
            let data = {};
            for (let key in localStorage) {
                data[key] = localStorage.getItem(key);
            }
            return data;
        });
        if (cookies.length > 0) {
            fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        }

    }

    // Step 2: Upload Reel
    const reel = await loadNextReel();
    if (!reel) {
        console.log('No reels to upload.');
        await browser.close();
        return;
    }

    // Open upload modal
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('svg[aria-label="New post"]');
    await page.click('svg[aria-label="New post"]');
    await page.waitForSelector('input[type="file"]');

    // Upload video
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(reel.path);

    // Wait for preview and next buttons
    await new Promise(resolve => setTimeout(resolve, 5000));
    const Okbuttons = await page.$$('button');
    let popupOkBtn = null;
    for (const btn of Okbuttons) {
        const text = await (await btn.getProperty('innerText')).jsonValue();
        if (text.includes('OK') || text.includes('Got it')) {
            popupOkBtn = btn;
            break;
        }
    }

    if (popupOkBtn) {
        await popupOkBtn.click();
        console.log('Dismissed popup by clicking OK');
        await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
        console.log('No popup to dismiss');
    }

    // Debug log: print all buttons to see what texts appear
    // const buttons = await page.$$('[role="button"], button');
    // console.log('Buttons on page after upload:');
    // for (const btn of buttons) {
    //     const text = await (await btn.getProperty('innerText')).jsonValue();
    //     console.log(' -', text);
    // }

    // Find and click Next button (case-insensitive, contains 'next')
    const possibleNextElements = await page.$$('[role="button"], button');
    let nextBtn = null;

    for (const el of possibleNextElements) {
        const text = await (await el.getProperty('innerText')).jsonValue();
        if (text && text.toLowerCase().includes('next')) {
            nextBtn = el;
            break;
        }
    }


    if (nextBtn) {
        await nextBtn.click();
        console.log('Clicked Next button');
        const possibleNextElement = await page.$$('[role="button"], button');
        nextBtn = null;

        for (const el of possibleNextElement) {
            const text = await (await el.getProperty('innerText')).jsonValue();
            if (text && text.toLowerCase().includes('next')) {
                nextBtn = el;
                break;
            }
        }
        await nextBtn.click();
        console.log('Clicked Next button');

    } else {
        console.log('Next button not found');
        await browser.close();
        return;  // stop if Next button not found, no point continuing
    }

    await new Promise(resolve => setTimeout(resolve, 5000));


    // Add caption with fallback selector
    let captionSelector = 'textarea[aria-label="Write a caption…"]';

    try {
        await page.waitForSelector(captionSelector, { timeout: 7000 });
    } catch {
        // fallback if textarea not found
        captionSelector = 'div[contenteditable="true"]';
        await page.waitForSelector(captionSelector, { timeout: 10000 });
    }

    await page.type(captionSelector, reel.caption, { delay: 50 });

    // Find and click Share button
    const shareButtons = await page.$$('[role="button"], button');
    let shareBtn = null;

    for (const btn of shareButtons) {
        const text = await (await btn.getProperty('innerText')).jsonValue();
        if (text.trim().toLowerCase() === 'share') {
            shareBtn = btn;
            break;
        }
    }

    if (shareBtn) {
        await shareBtn.click();
        console.log(`✅ Posted: ${path.basename(reel.path)}`);
    } else {
        console.log('❌ Share button not found');
    }

    await new Promise(resolve => setTimeout(resolve, 10000));


    // Close browser after done
    await browser.close();
})();
