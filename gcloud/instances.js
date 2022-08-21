var config = require('./config.json');
require('dotenv').config();
const compute = require('@google-cloud/compute');
//{ mode: 'all', name: 'mcas', zone: 'us-central1-a', action: 'start' }
var args = require('minimist')(process.argv.slice(2)); // {mode:single / all ,name:mcas, zone: us-central1-a ,action:start}



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

async function listAllInstances() {
    let zoneWiseBreakup = [];
    let allInstances = [];
    const instancesClient = new compute.InstancesClient();

    //Use the `maxResults` parameter to limit the number of results that the API returns per response page.
    const aggListRequest = instancesClient.aggregatedListAsync({
        project: config.projectId,
        maxResults: 9999,
    });

    console.log('Instances found:');

    // Despite using the `maxResults` parameter, you don't need to handle the pagination
    // yourself. The returned object handles pagination automatically,
    // requesting next pages as you iterate over the results.
    for await (const [zone, instancesObject] of aggListRequest) {
        const instances = instancesObject.instances;

        if (instances && instances.length > 0) {
            let instanceObj = { zone: zone.split('/')[zone.split('/').length - 1], machineList: [] };
            console.log(` ${zone}`);
            for (const instance of instances) {
                instanceObj.machineList.push({ name: instance.name, zone: instance.zone.split('/')[instance.zone.split('/').length - 1], machineType: instance.machineType })
                allInstances.push({ name: instance.name, zone: instance.zone.split('/')[instance.zone.split('/').length - 1], machineType: instance.machineType })
                //console.log(` - ${instance.name} (${instance.machineType})`);
            }
            zoneWiseBreakup.push(instanceObj);
        }
    }
    return { zoneWiseBreakup, allInstances };
}


(async function () {
    if (args.action === "start") {
        if (args.mode === "single") {
            await startInstance(args.zone, args.name);
        }
        if (args.mode === 'zone') {
            let allMachines = await (await listAllInstances()).zoneWiseBreakup;
            let zoneInstances = allMachines.filter(x => x.zone == args.zone)[0];
            zoneInstances.machineList.forEach(async x => {
                await startInstance(x.zone, x.name);
            })
        }
        if (args.mode === "all") {
            let allMachines = await (await listAllInstances()).allInstances;
            allMachines.forEach(async x => {
                await startInstance(x.zone, x.name);
            })
        }
    } if (args.action === "stop") {
        if (args.mode === "single") {
            await stopInstance(args.zone, args.name)
        }
        if (args.mode === 'zone') {
            let allMachines = await (await listAllInstances()).zoneWiseBreakup;
            let zoneInstances = allMachines.filter(x => x.zone == args.zone)[0];
            zoneInstances.machineList.forEach(async x => {
                await stopInstance(x.zone, x.name);
            })
        }
        if (args.mode === "all") {
            let allMachines = await (await listAllInstances()).allInstances;
            allMachines.forEach(async x => {
                await stopInstance(x.zone, x.name);
            })
        }
    }
}());

