var config = require('./config.json');
require('dotenv').config();
const compute = require('@google-cloud/compute');
var jp = require('jsonpath');
var args = require('minimist')(process.argv.slice(2));
var request = require('sync-request');
var zoneMapping = require('./instance-zone-mapping.json');


function getRunners() {
    var runners = request('GET', new URL('/repos/ncr-swt-hospitality/EngageMobileAppAutomation_Actions/actions/runners', config.baseUrl).href, {

        headers: {
            'content-type': 'application/json',
            'authorization': config.PAT,
            "User-Agent": "Automation"
        }
    });
    let allrunners = JSON.parse(runners.getBody('utf8')).runners;
    return {
        allrunners: allrunners,
        activeRunners: allrunners.filter(x => x.status === "online"),
        offlineRunners: allrunners.filter(x => x.status === "offline"),
    }
}

async function sleep(ms) {
    await new Promise(r => setTimeout(r, 2000));
}

function getQueuedRuns() {
    //gets the runs that are queued or in progress
    var runs = request('GET', new URL("/repos/ncr-swt-hospitality/EngageMobileAppAutomation_Actions/actions/runs", config.baseUrl).href, {
        headers: {
            authorization: config.PAT,
            accept: '*/*',
            "User-Agent": "Automation"
        }
    });
    return jp.query(JSON.parse(runs.getBody('utf8')), "$..workflow_runs[?(@.status=='in_progress' || @.status== 'queued')]")
}




/**
 * If queued.length ==0 , allrunners.status== online ,allrunners.busy = false -- there are no pending jobs in the pipeline -- shutdown the machine 
 * If queued.length>0, allrunnes.status==online ,allrunners.busy=true,-- all runners are busy with jobs and there are queued jobs -- do not shutdown
 * If queued.length>0, all runners.status==offline ,allrunners.busy=false -- all runners are offline and we need to start the machines (start one machines )
 * If queued.length>0 allrunners[0].status==online ,allrunners[1].status==offline allrunners[0].busy=true, allrunners[1].busy=false -- start only offline machine
 * If no of jobs in progress == no of agents -- nothing to do 
 * if no of jobs in progress > no of agents -- start the stopped agents
 * If no of Jobs in progress < no of agents -- stop the agents 
 */
async function startInstance(zone, name) {
    const instancesClient = new compute.InstancesClient();

    const [response] = await instancesClient.start({
        project: config.projectId,
        zone,
        instance: name,
    });
    let operation = response.latestResponse;
    const operationsClient = new compute.ZoneOperationsClient();

    // Wait for the operation to complete.
    while (operation.status !== 'DONE') {
        [operation] = await operationsClient.wait({
            operation: operation.name,
            project: config.projectId,
            zone: operation.zone.split('/').pop(),
        });
    }

    console.log(`Instance - ${name} started.`);
}

async function stopInstance(zone, name) {
    const instancesClient = new compute.InstancesClient();

    const [response] = await instancesClient.stop({
        project: config.projectId,
        zone,
        instance: name,
    });
    let operation = response.latestResponse;
    const operationsClient = new compute.ZoneOperationsClient();

    // Wait for the operation to complete.
    while (operation.status !== 'DONE') {
        [operation] = await operationsClient.wait({
            operation: operation.name,
            project: config.projectId,
            zone: operation.zone.split('/').pop(),
        });
    }

    console.log(`Instance - ${name} stopped.`);
}


(async function () {
    if (args.action === 'start') {
        let runnerInfo = getRunners();
        let queued = getQueuedRuns()
        // queued -1 offline-2 online-0
        /**
         * 
         */
        // if no of runners that are active are less than no of queued jobs then start the runners
        while (runnerInfo.offlineRunners.length > 0 && runnerInfo.activeRunners.length < queued.length) {
            //starting the instance only if active runners are not available 
            await startInstance(zoneMapping[runnerInfo.offlineRunners[0].name], runnerInfo.offlineRunners[0].name);
            let beforeLength = runnerInfo.activeRunners.length //0
            //await sleep(20000);
            do {
                await sleep(500);
                runnerInfo = getRunners();
            } while (runnerInfo.activeRunners.length === beforeLength);
            queued = getQueuedRuns();
        }

        /**
         * Check if the runners are online 
         * check if runners are busy 
         * if online and busy and there are runners which are offline then switchon the runners
         * wait until the runners are not busy and proceed to next step  
         */
    }

    if (args.action === 'stop') {
        let runnerInfo = getRunners();
        let queued = getQueuedRuns()

        runnerInfo.activeRunners.forEach(async y => {
            if (!y.busy && queued.length <= runnerInfo.activeRunners.length) {
                await stopInstance(zoneMapping[y.name], y.name);
                runnerInfo = getRunners();
                queued = getQueuedRuns();
            }
        })

    }
}());

