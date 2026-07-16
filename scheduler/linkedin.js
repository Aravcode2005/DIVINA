const { chromium } = require('playwright');

async function posttoLinkedin(content) {
    const browser = await chromium.launch({
        headless: false
    });
    const context = await browser.newContext({
        storageState: 'auth.json'
    });
    const page = await context.newPage();
    await page.goto(
        'https://www.linkedin.com/feed/'
    );
    await page.waitForTimeout(4000);
    await page.getByText(
        'Start a post'
    ).click();
    const textbox = page
        .locator('[role="textbox"]')
        .last();
    await textbox.waitFor();
    await textbox.click();
    await textbox.pressSequentially(content);
    await page.waitForTimeout(2000);
    const postButton = page
        .getByRole('button', {
            name: 'Post'
        })
        .last();

    console.log(
        "Button enabled:",
        await postButton.isEnabled()
    );

    await postButton.click();

    await page.waitForTimeout(5000);
    console.log("BC!!!!!!!!");

    await browser.close();
}

module.exports = {
    posttoLinkedin
};