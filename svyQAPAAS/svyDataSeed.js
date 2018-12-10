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
 * @properties={typeid:24,uuid:"D92AC432-EE2D-45F6-A0F1-7E0EBE8A5D35"}
 */
function runDataseedFromWorkspace() {
	if (application.isInDeveloper()) {
		var workspacePath = getWorkspacePath();
		var i, j, seedDbs, subFiles
		var seeds = plugins.file.convertToJSFile(workspacePath + '/svyQAPAAS/medias/dataseeds/');
		if (seeds && seeds.isDirectory()) {
			seedDbs = seeds.listFiles();
			for (i in seedDbs) {
				if (seedDbs[i].isDirectory()) {
					subFiles = seedDbs[i].listFiles();
					for (j in subFiles) {
						if (subFiles[j].getName().match('.csv')) {
							importCsvFile(seedDbs[i].getName(), subFiles[j].getAbsoluteFile());
						}
					}
				}
			}
		}
	}
}

/**
 * @private
 * @param {String} dbName
 * @param {plugins.file.JSFile} csvFile
 *
 * @properties={typeid:24,uuid:"51493998-12F6-4CA9-A869-7DC65DAAB682"}
 */
function importCsvFile(dbName, csvFile) {
	if (databaseManager.getDatabaseProductName(dbName)) {
		try {
			var fileName = csvFile.getName().split('/').pop();
			fileName = fileName.split('.')[0];
			application.output('Import of file: ' + dbName + ' / ' + fileName + ' -Started-');
			var table =  databaseManager.getTable(dbName, fileName);
			plugins.rawSQL.executeSQL(dbName, 'TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE');
			if (plugins.file.getFileSize(csvFile) > 0) {
				var csv = scopes.svyDataUtils.parseCSV(plugins.file.readTXTFile(csvFile));
					
				for each (var row in csv.data) {
					var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' ('+  csv.columnNames.join(',')+') VALUES (' + row.map(function(value, index) {
						if(value || !table.getColumn(csv.columnNames[index]).getAllowNull()) {
							return "'" + value + "'";
						} else {
							return 'null';
						}
					}).join(',') + ');'
					
					plugins.rawSQL.executeSQL(dbName,query);
				}
				
				application.output('Import of file: ' + dbName + ' / ' + fileName + ' -done-');
			} else {
				application.output('Import of file: ' + dbName + ' / ' + fileName + ' -skipped / empty-');
			}
		} catch (e) {
			application.output(csvFile.getName() + ' has Errors', LOGGINGLEVEL.ERROR);
		}

	}
	return true;
}