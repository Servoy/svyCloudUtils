/**
 * @private
 * @return {String}
 * 
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
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @return {plugins.file.JSFile} zipped dataseed file
 * 
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles(customPathToSVYQapaas, returnDataseedFile) {
	var databases = [];
	datasources['db']['allnames'].forEach(function(item) {
		if(item != 'repository_server') {
			databases.push(item.toString());
		}
	})
	var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
	return createDataSeedFile(selectedDB, customPathToSVYQapaas, returnDataseedFile);
}

/**
 * @public 
 * @param {String|Boolean} dataseedToRemove Dataseed to Remove, boolean true will remove all
 * @param {String} [customDataseedPath]
 * @properties={typeid:24,uuid:"EA5C78EC-8BD9-47AB-B45C-AF24BBC470B7"}
 */
function removeExistingDataSeedFile(dataseedToRemove, customDataseedPath) {
	var workspacePath = application.isInDeveloper() ? getWorkspacePath() : scopes.svySystem.getSystemProperties().javaIoTmpdir;
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
 * @private 
 * @param {String} dbName
 * @param {JSTable} jsTable
 * @param {Array<{fieldName: String, value: String|Number}>} [additionalFilters]
 * @return {{query: String, cntQuery: QBSelect, args: Array<*>}}
 * @properties={typeid:24,uuid:"F6B909B6-76E3-48A2-9A57-9728EC843BB4"}
 */
function buildSelectSQL(dbName, jsTable, additionalFilters) {
	var dataProviderIds = jsTable.getColumnNames();
	var sql = databaseManager.createSelect(jsTable.getDataSource());
	for (var d = 0; d < dataProviderIds.length; d++) {
		sql.result.add(sql.columns[dataProviderIds[d]]);
	}
	
	//Add sort to have a better offset
	//TODO: IS THIS NEEDED??
	//sql.sort.add(sql.columns[jsTable.getRowIdentifierColumnNames()[0]].asc);
	
	var cntSql = databaseManager.createSelect(jsTable.getDataSource());
	cntSql.result.clear();
	cntSql.result.add(cntSql.getColumn(jsTable.getRowIdentifierColumnNames()[0]).count);
	
	if(additionalFilters) {
		for each(var filter in additionalFilters) {
			if(jsTable.getColumn(filter.fieldName)) {
				sql.where.add(sql.columns[filter.fieldName].eq(filter.value)); //Add to the data query
				cntSql.where.add(cntSql.columns[filter.fieldName].eq(filter.value)); //Add to countQuery
			}
		}
	}
	
	//Parse to string & args array
	var dbSQL = databaseManager.getSQL(sql,false);
	var queryArgs = databaseManager.getSQLParameters(sql, false)||[];
	
	
	if(isPostgresDB(dbName)) {
		for (d = 0; d < dataProviderIds.length; d++) {
			//When timestamp make it return UTC so it will be imported correctly
			if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.DATETIME) {
				dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[d]),"timezone('UTC',"+jsTable.getSQLName() + "." + dataProviderIds[d]+ ")")
			}
		}
		dbSQL += ' LIMIT ? OFFSET ?';
	} else if(isMicrosoftDB(dbName)) {
		for (d = 0; d < dataProviderIds.length; d++) {
			//When timestamp make it return UTC so it will be imported correctly
			if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.DATETIME) {
				dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[d]),jsTable.getSQLName() + "." + dataProviderIds[d]+ " AT TIME ZONE 'UTC'")
			}
		}
		
		dbSQL += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;';
	} else {
		return null;
	}
	
	return {query: dbSQL, cntQuery: cntSql, args: queryArgs};
}


/**
 * @private 
 * @param {String} dbName
 * @param {Array<*>} args
 * @param {Number} offset
 *
 * @properties={typeid:24,uuid:"1072416E-CDA0-419A-A8EB-BB14A4A939F4"}
 */
function addOffsetArgs(dbName, args, offset) {
	if(isPostgresDB(dbName)) {
		return args.concat([50000, offset])
	} else if(isMicrosoftDB(dbName)) {
		return args.concat([offset, 50000]);
	} else {
		return null;
	}
}
/**
 * @public
 * @param {String} selectedDB
 * @param {String} [customPathToSVYQapaas]
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @param {Array<{fieldName: String, value: String|Number}>} [additionalFilters] when given the query will add this to the where class (when field exists)
 * 
 * @return {plugins.file.JSFile} zipped dataseed file
 *
 * @properties={typeid:24,uuid:"67C8AFB5-1DE1-43D0-BFA9-4AFBDFFB50E3"}
 */
function createDataSeedFile(selectedDB, customPathToSVYQapaas, returnDataseedFile, additionalFilters) {
	var zip = null;
	if (!selectedDB) {
		return zip;
	}
	
	if(returnDataseedFile == undefined) {
		returnDataseedFile = application.isInDeveloper();
	}
	
	var workspacePath = returnDataseedFile ? getWorkspacePath() : scopes.svySystem.getSystemProperties().javaIoTmpdir;
	var tables = databaseManager.getTableNames(selectedDB);
	var dbFolderPath = [workspacePath, 'svyQAPAAS', 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
	var tempFolder = [scopes.svySystem.getSystemProperties().javaIoTmpdir,'temp_export'].join(scopes.svyIO.getFileSeperator());
	if (customPathToSVYQapaas) {
		dbFolderPath = [customPathToSVYQapaas, 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
		tempFolder = [scopes.svySystem.getSystemProperties().javaIoTmpdir, 'temp_export'].join(scopes.svyIO.getFileSeperator());
	}

	removeExistingDataSeedFile(selectedDB, customPathToSVYQapaas);
	plugins.file.createFolder(dbFolderPath);
	plugins.file.deleteFolder(tempFolder,false);
	plugins.file.createFolder(tempFolder);

	for each (var table in tables) {
		try {
			var fs = databaseManager.getFoundSet(selectedDB, table);
			var jsTable = databaseManager.getTable(fs);
			fs.clear();
		} catch (e) {
			application.output('Could not get foundset for table: ' + table, LOGGINGLEVEL.DEBUG);
			application.output(e.message, LOGGINGLEVEL.WARNING);
			if(true) {
				continue;
			}
		}
		
		if (jsTable.isMetadataTable()) {
			application.output("Skipping metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
			continue
		} else if(Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) { 
			application.output("Skipping i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
			continue
		}
		
		var queryObj = buildSelectSQL(selectedDB, jsTable, additionalFilters);
		var tableCount = databaseManager.getDataSetByQuery(queryObj.cntQuery,1).getValue(1,1);
		var offset = 0;
		var exportFile = plugins.file.convertToJSFile(tempFolder + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '.csv');
		
		application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + tableCount + ') -start-');
		do {
			var queryTime = new Date();
			var dataset = databaseManager.getDataSetByQuery(selectedDB,queryObj.query,addOffsetArgs(selectedDB,queryObj.args,offset),-1);
			offset += dataset.getMaxRowIndex();
			application.output('Export of table: ' + selectedDB + ' / ' + table + ' (getting/parsing offset: ' + offset + ', querytime: ' + (new Date().getTime() - queryTime.getTime()) + 'ms ) -running-', LOGGINGLEVEL.DEBUG);
			var writeTime = new Date();
			if(plugins.file.getFileSize(exportFile) == 0) {
				plugins.file.writeTXTFile(exportFile, dataset.getAsText(',','\r\n','"',true), 'UTF-8');
			} else {
				plugins.file.appendToTXTFile(exportFile, dataset.getAsText(',','\r\n','"',false), 'UTF-8');
			}
//			application.sleep(200)
			application.output('total write time: ' + (new Date().getTime() - writeTime.getTime()))
		} while (offset < tableCount);
		application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + offset + ') -done-');
	}

	if(plugins.file.convertToJSFile(tempFolder).listFiles().length > 0) {
		zip = scopes.svyIO.zip(plugins.file.convertToJSFile(tempFolder), plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB + '.zip'));
	}
	plugins.file.deleteFolder(tempFolder, false);

	application.output('Export of database: ' + selectedDB + ' -done-');
	return zip;
}

/**
 * @constructor
 * @param {JSMedia|plugins.file.JSFile} file
 * @param {String} dbName
 *
 * @properties={typeid:24,uuid:"561F6E1D-C532-4955-8C88-06EDD46DE974"}
 */
function DataseedFile(file, dbName) {
	/**
	 * @protected 
	 * @type {JSMedia|plugins.file.JSFile}
	 */
	this.file = file
	/**
	 * @public  
	 * @type {String}
	 */
	this.dbName = dbName;
	
	/**
	 * @public  
	 * @type {String}
	 */
	this.fileName = (file instanceof JSMedia ? file.getName().split('/').pop() : file.getName())

	/** 
	 * @public 
	 * @type {Array<byte>}
	 */
	this.getBytes = function() {
		if(file instanceof JSMedia) {
			return file.bytes;
		} else {
			return file.getBytes();
		}
	}
}

/**
 * 
 * @public
 * @return {Array<{DataseedFile}>}
 *  
 * @properties={typeid:24,uuid:"F973A092-AF92-4CCD-AD4D-1FCA15B162BD"}
 */
function getExistingDataseeds() {
	var existingDataseeds = [];
	var mediaList = solutionModel.getMediaList();
	for each (var media in mediaList) {
		if (media && media.getName().match('dataseeds')) {
			var splitString = media.getName().split('/');
			if (media.getName().match('.zip')) {
				existingDataseeds.push(new DataseedFile(media, splitString.pop().replace('.zip', '')));
			}
		}
	}
	return existingDataseeds;
}

/**
 * @param {Boolean} [clearTablesNotInSeed] optional Clear all tables that are not in the dataseed zip file of the db server.
 * @param {plugins.file.JSFile} [dataseedFile] file to import instead of all files from media
 * @param {String} [dbNameToImport] databaseName to import the given dataseedfile (only works when other param is set)
 * @public
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia(clearTablesNotInSeed, dataseedFile, dbNameToImport) {
	var file, tableName
	var mediaList = getExistingDataseeds()||[new DataseedFile(dataseedFile,dbNameToImport)];
	var seededTables = [];
	for each (var importFile in mediaList) {
			file = plugins.file.createTempFile('', '.zip');
			plugins.file.writeFile(file, importFile.getBytes());
			var unzipedFolder = scopes.svyIO.unzip(file);
			if (unzipedFolder && unzipedFolder.isDirectory()) {
				var zipContent = plugins.file.getFolderContents(unzipedFolder);
				zipContent.forEach(/**@param {plugins.file.JSFile} folderItem */ function(folderItem) {
					if (folderItem.isFile() && folderItem.getName().match('.csv')) {
						tableName = folderItem.getName().replace('.csv', '');
						importCsvFile(importFile.dbName, tableName, folderItem);
						seededTables.push(tableName);
					}
				})
			}

			plugins.file.deleteFile(file);
			plugins.file.deleteFolder(unzipedFolder, false);
			
			if(clearTablesNotInSeed == true) {
				var tables = databaseManager.getTableNames(importFile.dbName);
				for each(var table in tables) {
					if(seededTables.indexOf(table) == -1) {
						var jsTable = databaseManager.getTable(importFile.dbName, table);
						if (jsTable.isMetadataTable()) {
							application.output("Skipping clearing metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
						} else if(Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) { 
							application.output("Skipping clearing i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
						} else {
						if (isMicrosoftDB(importFile.dbName)) {
							executeQuery(importFile.dbName,jsTable,['delete from ' + jsTable.getQuotedSQLName() + ';']);
						} else {
							executeQuery(importFile.dbName,jsTable,['TRUNCATE TABLE ' + jsTable.getQuotedSQLName() + ' CASCADE;']);
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
					executeQuery(dbName,table,['TRUNCATE TABLE ' + table.getQuotedSQLName() + ' CASCADE;']);
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
									if(value) {
										if(new RegExp(/^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/).test(value)) {
											var newDate = utils.dateFormat(utils.parseDate(value.replace('T',' '),'yyyy-MM-dd HH:mm:ssZ','UTC'), 'yyyy-MM-dd HH:mm:ss');
											if(newDate) {
												return "'" + newDate + "'"; 
											}
										} else {
											newDate = utils.dateFormat(new Date(value), 'yyyy-MM-dd HH:mm:ss');
											return "'" + newDate + "'"; 
										}
									}
									return 'NULL'; 
								break;
								case JSColumn.INTEGER:
									var returnInt = ['', 'Infinity', 'NaN'].indexOf(value.toString()) != -1 ? 'NULL' : parseInt(value.toString());
									if (returnInt == NaN) {
										returnInt = 'NULL';
									} else if (returnInt != 'NULL') {
										// FIX for boolean in postgres
										returnInt = "'" +returnInt + "'";
									}
									return returnInt;
								break;
								case JSColumn.NUMBER:
									var returnNum = ['', 'Infinity', 'NaN'].indexOf(value.toString()) != -1 ? 'NULL' : parseFloat(value.toString());
									if(returnNum == NaN) {
										returnNum = 'NULL';
									}
									return returnNum;
								break;
								case JSColumn.MEDIA:
									return 'NULL';
								break;
								default:
									if(!value && column.getAllowNull()){
										return 'NULL';
									} else {
										if(value && value.length > column.getLength()) {
											value = value.substr(0,column.getLength())
										}
										return "'" + utils.stringReplace(value||"", "'", "''") + "'";
									}
								break;
							}
						});

						var query = 'INSERT INTO ' + table.getQuotedSQLName() + ' ("' + header.join('", "') + '") VALUES (' + values.join(', ') + ');'

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
	
	if(isPostgresDB(dbName)) {
		if(table.getColumn(table.getRowIdentifierColumnNames()[0]).getSequenceType() == JSColumn.DATABASE_SEQUENCE && table.getColumn(table.getRowIdentifierColumnNames()[0]).getType() == JSColumn.INTEGER) {
			queryToExec.push("SELECT setval(pg_get_serial_sequence('" + table.getSQLName() + "', '"+ table.getRowIdentifierColumnNames()[0]+ "'), COALESCE(CAST(max(" + table.getRowIdentifierColumnNames()[0]+ ") AS INT), 1)) FROM " + table.getQuotedSQLName() + ";");
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
 * @private 
 * 
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"BACF2886-97FF-4632-A811-8C94B56C47F7"}
 */
function isMicrosoftDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('microsoft') ? true : false;
}

/**
 * @private
 * 
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"8F328B4E-B7E9-4D6A-8F9E-F8664CC97052"}
 */
function isPostgresDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('postgres') ? true : false;
}