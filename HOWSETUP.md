# How to Set Up the Aternos Auto-AFK Bot
This guide will walk you through the steps to set up the Aternos Auto-AFK Bot on your server. Follow these instructions carefully to ensure a smooth installation and configuration process.

## Have 2 ways to set up the bot:

* **In your terminal**
* **Free Hosting**

---
### 1. Setting Up the Bot in Your Terminal
#### Step 1: Clone the Repository
Open your terminal and run the following command to clone the repository:
```bash
git clone https://github.com/DKHRAPTH/AFK-AternosBot
```
#### Step 2: Navigate to the Project Directory
```bash
cd AFK-AternosBot
```
#### Step 3: Install Dependencies
Make sure you have Node.js installed. Then, run:
```bash
npm install
```
#### Step 4: Configure the Bot
Change the `settings.json` file in the directory of the project and add your Aternos server details. The structure should look like this:
```json
{
    "host": "your-server.aternos.me",
    "port": "your-server-port",
    "username": "your-name-bot",
    "edition": "bedrock", // or "java",
    "javaVersion": "1.21.11" // Only required for Java Edition servers
}
```
#### Step 5: Start the Bot
Run the following command to start the bot:
```bash
npm start
```
#### Step 6: Access the Web Dashboard
Open your web browser and navigate to `http://localhost:5000` to access the dashboard. Here you can monitor logs and control the bot in real-time.

----
### 2. Setting Up the Bot on Free Hosting
#### Step 1: Choose a Free Hosting Platform
There are several free hosting platforms available, in this guide we will use [VortexaCloud](https://www.vortexa.cloud/).(Render isnt working for some reason)

#### Step 2: Create an Account and New Project
Sign up for an account on VortexaCloud
#### Step 3: Go to panel, login and upload files
Go to the panel, login and upload the files of the project

#### Step 4: Open Setting.json and add your server details
Change the `settings.json` file in the directory of the project and add your Aternos server details and save file.

#### step 5: Open Index.js and change the port to VortexaCloud port
Open `index.js` and change the port to the one provided by VortexaCloud and save file.

#### Step 6: Go to the console and click run
Go to the console and click run, then open the address provided by VortexaCloud on the web to access the dashboard. Here you can monitor logs and control the bot in real-time.



## [Back to README](./README.md)