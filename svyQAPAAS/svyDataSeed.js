/**
 * @private 
 * @properties={typeid:24,uuid:"960218D4-695E-4D1E-8472-7AD7AC9B5F99"}
 */
function getWorkspacePath() {
	var workspacePath = java.lang.System.getProperty("osgi.instance.area");
	if (scopes.svySystem.isWindowsPlatform()) {
		return workspacePath.substr(6, workspacePath.length);
	} else {
		return workspacePath.substr(5, workspacePath.length);
	}
}

/**
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles() {
	if (application.isInDeveloper()) {
		var databases = databaseManager.getServerNames();
		var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
		var workspacePath = getWorkspacePath();
		var tables = databaseManager.getTableNames(selectedDB);
		var dbFolderPath = workspacePath + '/svyQAPAAS/medias/dataseeds/' + selectedDB

		plugins.file.deleteFolder(dbFolderPath, false);
		plugins.file.createFolder(dbFolderPath)

		for each (var table in tables) {
			var fs = databaseManager.getFoundSet(selectedDB, table);
			fs.loadAllRecords();
			fs.getRecord(databaseManager.getFoundSetCount(fs));
			var ds = databaseManager.convertToDataSet(fs, databaseManager.getTable(fs).getColumnNames());
			var file = plugins.file.createFile(dbFolderPath + '/' + table + '.csv');
			plugins.file.writeTXTFile(file, ds.getAsText(';', '\n', '"', true));
			
			application.output('Export of table: ' + selectedDB + ' / ' + table + ' -done-');
		}
	}

}

/**
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia() {
	var mediaList = solutionModel.getMediaList();
	for each(var media in mediaList) {
		if (media && media.getName().match('dataseeds')) {
			if (media.getName().match('.csv')) {
				var splitString = media.getName().split('/');
				var tableName = splitString.pop().replace('.csv','');
				var dbName = splitString.pop();
				importCsvFile(dbName, tableName, scopes.svyDataUtils.byteArrayToString(media.bytes, 'UTF-8'));
			}
		}
	}
}

/**
 * @private
 * @param {String} dbName
 * @param {String} tableName
 * @param {String} data
 *
 * @properties={typeid:24,uuid:"51493998-12F6-4CA9-A869-7DC65DAAB682"}
 */
function importCsvFile(dbName, tableName, data) {
	try {
		application.output('Import of file: ' + dbName + ' / ' + tableName + ' -Started-', LOGGINGLEVEL.INFO);
		var table =  databaseManager.getTable(dbName, tableName);
		if(table) {
			plugins.rawSQL.executeSQL(dbName, 'TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE');
			var csv = scopes.svyDataUtils.parseCSV(data);
			if (csv.data.length > 0) {
				var counter = 0;
				var queryToExec = [];
				for each (var row in csv.data) {
					counter++;
					if(row.length && row[0] != undefined) {
						var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' ('+  csv.columnNames.join(', ')+') VALUES (' + row.map(function(value, index) {
							if((value && value != 0) || !table.getColumn(csv.columnNames[index]).getAllowNull()) {
								return "'" + utils.stringReplace(value,"'","''") + "'";
							} else {
								return 'null';
							}
						}).join(', ') + ');'
						
						queryToExec.push(query);
						if(counter % 200 == 0) {
							plugins.rawSQL.executeSQL(dbName,queryToExec.join('\n'));
							queryToExec = [];
							application.output('Executed insert sql ' + counter + ' of ' + csv.data.length, LOGGINGLEVEL.DEBUG);
						}
					}
				}
				plugins.rawSQL.executeSQL(dbName,queryToExec.join('\n'));
				application.output('Executed insert sql ' + counter + ' of ' + csv.data.length, LOGGINGLEVEL.DEBUG);
				application.output('Import of file: ' + dbName + ' / ' + tableName + ' -done-', LOGGINGLEVEL.INFO);
			} else {
				application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / empty-', LOGGINGLEVEL.INFO);
			}
		} else {
			application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / table not found on server!!-', LOGGINGLEVEL.INFO);
		}
	} catch (e) {
		application.output(dbName + '/' + tableName + ' has Errors', LOGGINGLEVEL.ERROR);
	}
	return true;
}