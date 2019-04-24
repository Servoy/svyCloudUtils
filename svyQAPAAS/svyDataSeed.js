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
	var dbFolderPath = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
	var tempFolder = [workspacePath, 'svyQAPAAS','temp_export'].join(scopes.svyIO.getFileSeperator());
	if (customPathToSVYQapaas) {
		dbFolderPath = [customPathToSVYQapaas, 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
		tempFolder = [customPathToSVYQapaas, 'temp_export'].join(scopes.svyIO.getFileSeperator());
	}

	removeExistingDataSeedFile(selectedDB, customPathToSVYQapaas);
	plugins.file.createFolder(dbFolderPath);
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
		var emptyDs = databaseManager.createEmptyDataSet(0,dataset.getColumnNames())
		var rows = 0;
		//Need to split it this way, will get error when doing a convert of 1 million+ records
		for (var i = 1; i <= dataset.getMaxRowIndex(); i++) {
			emptyDs.addRow(dataset.getRowAsArray(i));
			if (emptyDs.getMaxRowIndex() == 5000) {
				rows += emptyDs.getMaxRowIndex();
				if(plugins.file.getFileSize(exportFile) == 0) {
					plugins.file.writeTXTFile(exportFile, emptyDs.getAsText(',','\r\n','"',true), 'UTF-8');
				} else {
					plugins.file.appendToTXTFile(exportFile, emptyDs.getAsText(',','\r\n','"',false), 'UTF-8');
				}
				emptyDs = databaseManager.createEmptyDataSet(0,dataset.getColumnNames());
			}
		}
		
		rows += emptyDs.getMaxRowIndex();
		if(plugins.file.getFileSize(exportFile) == 0) {
			plugins.file.writeTXTFile(exportFile, emptyDs.getAsText(',','\r\n','"',true), 'UTF-8');
		} else {
			plugins.file.appendToTXTFile(exportFile, emptyDs.getAsText(',','\r\n','"',false), 'UTF-8');
		}

		application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + rows + ') -done-');
	}

	if(plugins.file.convertToJSFile(tempFolder).listFiles().length > 0) {
		scopes.svyIO.zip(plugins.file.convertToJSFile(tempFolder), plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB + '.zip'));
	}
	plugins.file.deleteFolder(tempFolder, false);

	application.output('Export of database: ' + selectedDB + ' -done-');
	return true;
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
	/**@type {Array<String>} */
	var header = [];
	/**@type {Array<String>} */
	var fullHeader = [];
	var counter = 0;
	var queryToExec = [];
	var lineCount = scopes.svyIO.getLineCountForFile(file);
	var columnDiffs = [];
	var table = databaseManager.getTable(dbName, tableName);

	/**@param {Array} lineToImport */
	function importData(lineToImport) {
		if (table) {
			//Assume it is the first line, so do init calles;
			if (header.length == 0) {
				if (isMicrosoftDB(dbName)) {
					executeQuery(dbName,table,['delete from ' + table.getQuotedSQLName() + ';']);
				} else {
					executeQuery(dbName,table,['TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE']);
				}

				header = lineToImport;
				fullHeader = header;

				// verify the header columns
				columnDiffs = getTableSchemaDiff(table, header);
				if (columnDiffs.length) {
					application.output('Table: ' + tableName + ' has more column in export then in table; the following columns don\'t exists in table: ' + columnDiffs.join(','), LOGGINGLEVEL.WARNING);
				}
				
				//Clear header with missing columns
				header = header.filter(function(item) {
					return (columnDiffs.indexOf(item) === -1)
				})

			} else {
				if (lineToImport) {
					counter++;
					if (lineToImport.length && lineToImport[0] != undefined) {
						
						lineToImport = lineToImport.filter(function(item,index) {
							for(var i in columnDiffs) {
								if(fullHeader.indexOf(columnDiffs[i]) == index) {
									return false;
								}
							}
							return true;
						})
						
						var values = lineToImport.map(
						/**
						 * @param {*} value
						 * @param {Number} index
						 * @return {String|Number} 
						 */
						function(value, index) {
							var column = table.getColumn(header[index]);
							//Convert types
							switch (column.getType()) {
								case JSColumn.DATETIME:
									return !value ? 'NULL' : "'" + utils.dateFormat(new Date(value), 'yyyy-MM-dd HH:mm:ss') + "'"; 
								break;
								case JSColumn.INTEGER:
									return value.toString() == '' ? 'NULL' : parseInt(value.toString());
								break;
								case JSColumn.NUMBER:
									return value.toString() == '' ? 'NULL' : parseFloat(value.toString());
								break;
								case JSColumn.MEDIA:
									return 'NULL';
								break;
								default:
									if(!value && column.getAllowNull()){
										return 'NULL';
									} else {
										return "'" + utils.stringReplace(value||"", "'", "''") + "'";
									}
								break;
							}
						});

						var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' (' + header.join(', ') + ') VALUES (' + values.join(', ') + ');'

						queryToExec.push(query);
						if (counter % 500 == 0) {
							if(!executeQuery(dbName,table,queryToExec)) {
								application.output('FAILED TO INSERT insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.ERROR);
							}

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
		return true;
	}

	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -Started-', LOGGINGLEVEL.INFO);
	
	if(tableName == 'employees') {
		application.output('test')
	}
	var csvObj = scopes.svyDataUtils.parseCSV(plugins.file.readTXTFile(file,'UTF-8'), {delimiter: ',', firstRowHasColumnNames: true, textQualifier: '"'});
	importData(csvObj.columnNames)
	csvObj.data.forEach(function(row) {
		importData(row);
	});
	
	if (queryToExec.length != 0) {
		if(!executeQuery(dbName,table,queryToExec)) {
			application.output('FAILED TO INSERT insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.ERROR);
		}

		application.output('Executed insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.DEBUG);
	}
	plugins.rawSQL.flushAllClientsCache(dbName, tableName);
	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -done-', LOGGINGLEVEL.INFO);

	return true;
}


/**
 * @private 
 * @param {String} dbName
 * @param {JSTable} table
 * @param {Array<String>} queryToExec
 * @properties={typeid:24,uuid:"5D709450-106B-4A9C-A5D3-307FF00418AB"}
 */
function executeQuery(dbName, table, queryToExec) {
	var preInsertSQL = '';
	var postInsertSQL = '';
	var disableConstraints = '';
	var enableConstraints = '';

	if (isMicrosoftDB(dbName)) {
		disableConstraints = "ALTER TABLE " + table.getQuotedSQLName() + " NOCHECK CONSTRAINT ALL;";
		enableConstraints = "ALTER TABLE " + table.getQuotedSQLName() + " CHECK CONSTRAINT ALL;";

		// enable/disable identity insert
		if (hasDatabaseIdentity(table)) {
			preInsertSQL += 'SET IDENTITY_INSERT ' + table.getQuotedSQLName() + ' ON;';
			postInsertSQL = 'SET IDENTITY_INSERT ' + table.getQuotedSQLName() + ' OFF;' + postInsertSQL;
		}
	}
	

	try {
		queryToExec.unshift(preInsertSQL);
		queryToExec.push(postInsertSQL);
		if (!plugins.rawSQL.executeSQL(dbName, queryToExec.join('\n'))) {
			throw "fail";
		}
	} catch (e) {
		// NOTE with alter tables it fails silently
		// NOTE because of an issue in the JDBC driver, when Alter Table is used, the JDBC driver sometimes doesn't recognize the change in the query
		// It reuse the previous query as prepared statement. SELECT ? where ? = 1 is used to force a refresh of the prepared statement
		queryToExec.unshift(disableConstraints);
		queryToExec.push(enableConstraints);
		queryToExec.push('SELECT ?;');
		if (!plugins.rawSQL.executeSQL(dbName, queryToExec.join('\n'), [1])) {
			return false;
		}
	}
	return true;
}
/**
 * @private
 * @param {JSTable} table
 * @param {Array<String>} header
 *
 * @return {Array<String>} verify the header columns vs the table
 *
 * @properties={typeid:24,uuid:"613FBEAA-543C-448C-8DB6-FB6090B87DB1"}
 */
function getTableSchemaDiff(table, header) {
	var missingColumns = [];
	var tableColumnNames = table.getColumnNames();
	for (var i = 0; i < header.length; i++) {
		if (tableColumnNames.indexOf(header[i].toLowerCase()) === -1) {
			missingColumns.push(header[i]);
		}
	}
	return missingColumns;
}

/**
 * @private
 * @param {JSTable} table
 *
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"35408E0E-9A19-47D0-BB43-32A938217FFC"}
 */
function hasDatabaseIdentity(table) {
	var pks = table.getRowIdentifierColumnNames();
	for (var i = 0; i < pks.length; i++) {
		if (table.getColumn(pks[i]).getSequenceType() === JSColumn.DATABASE_IDENTITY) {
			return true;
		}
	}
	return false;
}

/**
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"BACF2886-97FF-4632-A811-8C94B56C47F7"}
 */
function isMicrosoftDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('microsoft') ? true : false;
}