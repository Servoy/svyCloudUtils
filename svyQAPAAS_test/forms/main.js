
/**
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"FC3C298B-3769-46DE-9CDB-529D5A9E2FD6"}
 */
function createDataseedDownload(event) {
	var file = scopes.svyDataSeed.createDataSeedFiles(null,true);
	if(file) {
		plugins.file.writeFile(file.getName(),file.getBytes());
	}
}

/**
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"0D6F7486-BABD-4A08-8C56-496D9CCE3D06"}
 */
function createDataseed(event) {
	scopes.svyDataSeed.createDataSeedFiles();
}

/**
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"944130C6-3A41-4598-86E2-95EEB22AC51C"}
 */
function importAllDataseeds(event) {
	scopes.svyDataSeed.runDataseedFromMedia();
}

/**
 * Perform the element onclick action.
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"2682B94F-0EB8-408D-814B-2503C0E192F5"}
 */
function importSpecificDataseed(event) {
	var dataseeds = [];
	scopes.svyDataSeed.getExistingDataseeds().forEach(/**@param {scopes.svyDataSeed.DataseedFile} item */ function(item) {
		dataseeds.push(item.fileName);
	});
	
	var selectedDataseed = plugins.dialogs.showSelectDialog('Import dataseed', 'Select dataseed to import', dataseeds);
	if(selectedDataseed) {
		scopes.svyDataSeed.runDataseedFromMedia(true, plugins.file.convertToJSFile('/private/var/folders/w9/7w99w11j7n98tqbrxj3t4lf00000gn/T/svyQAPAAS/medias/dataseeds/really_large.zip'), 'smalldb')
	}
}

/**
 * Perform the element onclick action.
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"AAD14F44-F5E7-4B43-B1D8-FEC7D111E580"}
 */
function createDataseedWithFilters(event) {
	application.output('export started: ' + new Date())
	application.output('export done: ' + new Date())
}

/**
 * Perform the element onclick action.
 *
 * @param {JSEvent} event the event that triggered the action
 *
 * @private
 *
 * @properties={typeid:24,uuid:"8C3E7D33-328E-48BF-BB91-AF0A5D91BFEC"}
 */
function executeDbUtilsVersionUpgrade(event) {
	scopes.svyDeployUtils.runDBVersionUpgrade()
}
