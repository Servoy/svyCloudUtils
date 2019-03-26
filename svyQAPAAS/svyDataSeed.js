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
 * @param {String} [customPathToSVYQapaas]
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles(customPathToSVYQapaas) {
	if (application.isInDeveloper()) {
		var databases = databaseManager.getServerNames();
		var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
		createDataSeedFile(selectedDB, customPathToSVYQapaas);
	}
}

/**
 * @public 
 * @param {String|Boolean} dataseedToRemove Dataseed to Remove, boolean true will remove all
 * @param {String} [customDataseedPath]
 * @properties={typeid:24,uuid:"EA5C78EC-8BD9-47AB-B45C-AF24BBC470B7"}
 */
function removeExistingDataSeedFile(dataseedToRemove, customDataseedPath) {
	var workspacePath = getWorkspacePath();
	var dbFolderPathArray = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds'];
	if(customDataseedPath) {
		dbFolderPathArray = [customDataseedPath,'medias', 'dataseeds'];
	}
	
	if(dataseedToRemove instanceof Boolean) {
		plugins.file.deleteFolder(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()), false);
	} else {
		dbFolderPathArray.push(dataseedToRemove.toString());
		plugins.file.deleteFolder(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()), false);
		plugins.file.deleteFile(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()) + '.zip');
	}
}

/**
 * @public
 * @param {String} selectedDB
 * @param {String} [customPathToSVYQapaas]
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"67C8AFB5-1DE1-43D0-BFA9-4AFBDFFB50E3"}
 */
function createDataSeedFile(selectedDB, customPathToSVYQapaas) {
	if (!selectedDB) {
		return false;
	}
	
	var workspacePath = getWorkspacePath();
	var tables = databaseManager.getTableNames(selectedDB);
	var dbFolderPath = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds',selectedDB].join(scopes.svyIO.getFileSeperator());
	var tempFolder = [workspacePath, 'svyQAPAAS','temp_export'].join(scopes.svyIO.getFileSeperator());
	if (customPathToSVYQapaas) {
		dbFolderPath = [customPathToSVYQapaas, 'medias', 'dataseeds', selectedDB].join(scopes.svyIO.getFileSeperator());
		tempFolder = [customPathToSVYQapaas, 'temp_export'].join(scopes.svyIO.getFileSeperator());
	}

	removeExistingDataSeedFile(selectedDB, customPathToSVYQapaas);
	plugins.file.createFolder(tempFolder);

	for each (var table in tables) {
		var fs = databaseManager.getFoundSet(selectedDB, table);
		var jsTable = databaseManager.getTable(fs);
		
		if (databaseManager.getTable(fs).isMetadataTable()) {
			application.output("Skipping metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
			continue
		} else if(Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) { 
			application.output("Skipping i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
			continue
		}
		
		fs.loadAllRecords();
		if (!utils.hasRecords(fs)) {
			continue;
		}

		var fsQuery = databaseManager.getSQL(fs, false);
		var fsQueryParams = databaseManager.getSQLParameters(fs, false);
		var dataProviderIds = jsTable.getColumnNames();
		var pkColumns = jsTable.getRowIdentifierColumnNames();
		var qualifiedDataproviderIds = [];
		table = jsTable.getQuotedSQLName()
		for (var d = 0; d < dataProviderIds.length; d++) {
			qualifiedDataproviderIds.push(table + "." + jsTable.getColumn(dataProviderIds[d]).getQuotedSQLName());
		}
		for (var p = 0; p < pkColumns.length; p++) {
			pkColumns[p] = table + "." + jsTable.getColumn(pkColumns[p]).getQuotedSQLName();
		}

		var pkArgToReplace = 'select ' + pkColumns.join(', ');
		fsQuery = utils.stringReplace(fsQuery, pkArgToReplace, 'select ' + qualifiedDataproviderIds.join(', '));

		var dataset = databaseManager.getDataSetByQuery(selectedDB, fsQuery, fsQueryParams, -1);
		var exportFile = plugins.file.convertToJSFile(tempFolder + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '.csv');
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

	scopes.svyIO.zip(plugins.file.convertToJSFile(tempFolder), plugins.file.convertToJSFile(dbFolderPath + '.zip'));
	plugins.file.deleteFolder(tempFolder, false);

	application.output('Export of database: ' + selectedDB + ' -done-');
}

/**
 * @public
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia() {
	var file, tableName, dbName
	var mediaList = solutionModel.getMediaList();
	for each (var media in mediaList) {
		if (media && media.getName().match('dataseeds')) {
			var splitString = media.getName().split('/');
			if (media.getName().match('.zip')) {
				dbName = splitString.pop().replace('.zip', '');
				file = plugins.file.createTempFile('', '.zip');
				plugins.file.writeFile(file, media.bytes);
				var unzipedFolder = scopes.svyIO.unzip(file);
				if (unzipedFolder && unzipedFolder.isDirectory()) {
					var zipContent = plugins.file.getFolderContents(unzipedFolder);
					zipContent.forEach(/**@param {plugins.file.JSFile} folderItem */ function(folderItem) {
						if (folderItem.isFile() && folderItem.getName().match('.csv')) {
							tableName = folderItem.getName().replace('.csv', '');
							importCsvFile(dbName, tableName, folderItem);
						}
					})
				}

				plugins.file.deleteFile(file);
				plugins.file.deleteFolder(unzipedFolder, false);

			} else if (media.getName().match('.csv')) {
				tableName = splitString.pop().replace('.csv', '');
				dbName = splitString.pop();
				file = plugins.file.createTempFile('', '.csv');
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
				var deleteSql = 'TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE'
				if(databaseManager.getDatabaseProductName(dbName).match('microsoft')) {
					deleteSql = "alter table "+ table.getQuotedSQLName() + " nocheck constraint all;\
								 delete from " + table.getQuotedSQLName() + ";\
								 alter table "+ table.getQuotedSQLName() + " check constraint all;" 
				}
				plugins.rawSQL.executeSQL(dbName, deleteSql);
				header = line;
			} else {

				if (line) {
					counter++;
					if (line.length && line[0] != undefined) {
						var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' (' + header.join(', ') + ') VALUES (' + line.map(function(value, index) {
								//Convert types
								if (table.getColumn(header[index])) {
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
	plugins.rawSQL.flushAllClientsCache(dbName, tableName);
	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -done-', LOGGINGLEVEL.INFO);

	return true;
}
