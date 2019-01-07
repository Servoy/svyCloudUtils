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
 * @public
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles() {
	if (application.isInDeveloper()) {
		var databases = databaseManager.getServerNames();
		var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
		createDataSeedFile(selectedDB);
	}
}

/**
 * @public
 * @param {String} selectedDB
 *
 * @properties={typeid:24,uuid:"67C8AFB5-1DE1-43D0-BFA9-4AFBDFFB50E3"}
 */
function createDataSeedFile(selectedDB) {
	var workspacePath = getWorkspacePath();
	var tables = databaseManager.getTableNames(selectedDB);
	var dbFolderPath = workspacePath + scopes.svyIO.getFileSeperator() + 'svyQAPAAS' + scopes.svyIO.getFileSeperator() + 'medias' + scopes.svyIO.getFileSeperator() + 'dataseeds' + scopes.svyIO.getFileSeperator() + selectedDB

	plugins.file.deleteFolder(dbFolderPath, false);
	plugins.file.createFolder(dbFolderPath)

	for each (var table in tables) {
		var fs = databaseManager.getFoundSet(selectedDB, table);
		fs.loadAllRecords();

		if (!utils.hasRecords(fs)) {
			continue;
		}

		var fsQuery = databaseManager.getSQL(fs, false);
		var fsQueryParams = databaseManager.getSQLParameters(fs, false);
		var jsTable = databaseManager.getTable(fs);
		var dataProviderIds = jsTable.getColumnNames();
		var pkColumns = jsTable.getRowIdentifierColumnNames();
		var qualifiedDataproviderIds = [];
		table = jsTable.getQuotedSQLName()
		for (var d = 0; d < dataProviderIds.length; d++) {
			qualifiedDataproviderIds.push(table + "." + dataProviderIds[d]);
		}
		for (var p = 0; p < pkColumns.length; p++) {
			pkColumns[p] = table + "." + pkColumns[p];
		}

		var pkArgToReplace = 'select ' + pkColumns.join(', ');
		fsQuery = utils.stringReplace(fsQuery, pkArgToReplace, 'select ' + qualifiedDataproviderIds.join(', '));

		var dataset = databaseManager.getDataSetByQuery(selectedDB, fsQuery, fsQueryParams, -1);
		var exportFile = plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '.csv');
		var dataToWrite = [];

		plugins.file.writeTXTFile(exportFile, dataset.getColumnNames().join(';$;') + '\n', 'UTF-8');
		for (var i = 1; i <= dataset.getMaxRowIndex(); i++) {
			var dataRow = dataset.getRowAsArray(i);
			dataRow.map(/**@param {String} value */function(value) {
				if (value && (typeof value) == 'string' && value.match('\n')) {
					value = value.replace(/\n/, '\n')
				}
			})
			dataToWrite.push(dataRow.join(';$;'));
			if (dataToWrite.length == 5000) {
				plugins.file.appendToTXTFile(exportFile, dataToWrite.join('\n') + '\n', 'UTF-8');
				dataToWrite = [];
			}
		}
		plugins.file.appendToTXTFile(exportFile, dataToWrite.join('\n'), 'UTF-8');

		application.output('Export of table: ' + selectedDB + ' / ' + table + ' -done-');
	}
}

/**
 * @public
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia() {
	var mediaList = solutionModel.getMediaList();
	for each (var media in mediaList) {
		if (media && media.getName().match('dataseeds')) {
			if (media.getName().match('.csv')) {
				var splitString = media.getName().split('/');
				var tableName = splitString.pop().replace('.csv', '');
				var dbName = splitString.pop();
				var file = plugins.file.createTempFile('', '.csv');
				plugins.file.writeFile(file, media.bytes)
				importCsvFile(dbName, tableName, file);
				file.deleteFile();
			}
		}
	}
}

/**
 * @private
 * @param {String} dbName
 * @param {String} tableName
 * @param {plugins.file.JSFile} file
 *
 * @properties={typeid:24,uuid:"51493998-12F6-4CA9-A869-7DC65DAAB682"}
 */
function importCsvFile(dbName, tableName, file) {
	var header = '';
	var counter = 0;
	var queryToExec = [];
	var lineCount = scopes.svyIO.getLineCountForFile(file);

	/**@param {String} line */
	function importData(line) {
		line = line.split(';$;');
		var table = databaseManager.getTable(dbName, tableName);
		if (table) {
			//Assume it is the first line, so do init calles;
			if (!header) {
				plugins.rawSQL.executeSQL(dbName, 'TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE');
				header = line;
			} else {

				if (line) {
					counter++;
					if (line.length && line[0] != undefined) {
						var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' (' + header.join(', ') + ') VALUES (' + line.map(function(value, index) {
								//Convert types
								if (table.getColumn(header[index]).getType() == JSColumn.DATETIME) {
									if (value) {
										value = utils.dateFormat(new Date(value), 'yyyy-MM-dd HH:mm:ss');
									}
								} else if (table.getColumn(header[index]).getType() == JSColumn.TEXT) {
									if (value) {
										value = utils.stringReplace(value, '\\n', '\n');
									}
								}

								//Parse as string & add null values
								if ( (value && value != 0) || !table.getColumn(header[index]).getAllowNull()) {
									return "'" + utils.stringReplace(value, "'", "''") + "'";
								} else {
									return 'null';
								}
							}).join(', ') + ');'

						queryToExec.push(query);
						if (counter % 500 == 0) {
							plugins.rawSQL.executeSQL(dbName, queryToExec.join('\n'));
							queryToExec = [];
							application.output('Executed insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.DEBUG);
						}
					}
				} else {
					application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / empty-', LOGGINGLEVEL.INFO);
				}
			}
		} else {
			application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / table not found on server!!-', LOGGINGLEVEL.INFO);
		}
	}

	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -Started-', LOGGINGLEVEL.INFO);

	scopes.svyIO.readFile(file, importData, 'UTF-8');

	if (queryToExec.length != 0) {
		plugins.rawSQL.executeSQL(dbName, queryToExec.join('\n'));
		application.output('Executed insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.DEBUG);
	}
	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -done-', LOGGINGLEVEL.INFO);

	return true;
}
