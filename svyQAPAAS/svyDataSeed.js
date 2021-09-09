/**
 * @private
 * @return {String}
 * 
 * @properties={typeid:24,uuid:"960218D4-695E-4D1E-8472-7AD7AC9B5F99"}
 */
function getWorkspacePath() {
	var workspacePath = java.lang.System.getProperty("osgi.instance.area");
	if (scopes.svySystem.isWindowsPlatform()) {
	//Can't use scopes.svySystem.. that is also controlled by browser
	if (/Windows/.test(scopes.svySystem.getSystemProperties().osName)) {
		return workspacePath.substr(6, workspacePath.length);
	} else {
		return workspacePath.substr(5, workspacePath.length);
	}
}

/**
 * @public
 * @param {String} [customPathToSVYQapaas]
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @param {Boolean} [runFullTableRecalc] optional boolean to do a full table recalc when having storedcalcs.. will be heavy when there is a lot of data
 * @param {Boolean} [noZip] optional when true the export files will not be zipped, the folder with  plain csv will be part of the repository (do not use with large dataseed files)
 * @param {Array<String>} [excludeTableNames] Array with table names to filter for export, it has support for % as wildcard
 * @return {plugins.file.JSFile} zipped dataseed file
 * 
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles(customPathToSVYQapaas, returnDataseedFile, runFullTableRecalc, noZip, excludeTableNames) {
	var databases = [];
	datasources['db']['allnames'].forEach(function(item) {
		if(item != 'repository_server') {
			databases.push(item.toString());
		}
	})
	var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
	return createDataSeedFile(selectedDB, customPathToSVYQapaas, returnDataseedFile, null, runFullTableRecalc, null, noZip, excludeTableNames);
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
 * @param {Array<{fieldName: String, value: String|Number, [required]:Boolean}>} [additionalFilters]
 * @return {{query: String, cntQuery: QBSelect, args: Array<*>, largeDataFields: Boolean}|Boolean}
 * @properties={typeid:24,uuid:"F6B909B6-76E3-48A2-9A57-9728EC843BB4"}
 */
function buildSelectSQL(dbName, jsTable, additionalFilters) {
	var largeTxtFields = false;
	var dataProviderIds = jsTable.getColumnNames();
	var sql = databaseManager.createSelect(jsTable.getDataSource());
	for (var d = 0; d < dataProviderIds.length; d++) {
		if(jsTable.getColumn(dataProviderIds[d]).getType() != JSColumn.MEDIA || isPostgresDB(dbName)) {
			sql.result.add(sql.columns[dataProviderIds[d]]);
		} else if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.MEDIA && isMicrosoftDB(dbName)) {
			application.output("Found media column, media conversion isn't supported currently for MSSQL Server. Column will be skipped", LOGGINGLEVEL.WARNING)
		}
		
		if(jsTable.getColumn(dataProviderIds[d]).getLength() > 5000 || jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.MEDIA) {
			largeTxtFields = true;
		}
	}
	
	//Add sort to have a better offset && not have duplicates because of offset
	sql.sort.add(sql.columns[jsTable.getRowIdentifierColumnNames()[0]].asc);
	
	var cntSql = databaseManager.createSelect(jsTable.getDataSource());
	cntSql.result.clear();
	cntSql.result.add(cntSql.getColumn(jsTable.getRowIdentifierColumnNames()[0]).count);
	
	if(additionalFilters) {
		for each(var filter in additionalFilters) {
			if(jsTable.getColumn(filter.fieldName)) {
				sql.where.add(sql.columns[filter.fieldName].eq(filter.value)); //Add to the data query
				cntSql.where.add(cntSql.columns[filter.fieldName].eq(filter.value)); //Add to countQuery
			} else {
				if(filter.hasOwnProperty('required') && filter.required === true) {
					application.output("Skipping table: " + jsTable.getDataSource() + " additional filter added with required flag column (" + filter.fieldName+ ") not found", LOGGINGLEVEL.INFO);
					return false;
				}
			}
		}
	}
	
	//Parse to string & args array
	var dbSQL = databaseManager.getSQL(sql,false);
	var queryArgs = databaseManager.getSQLParameters(sql, false)||[];
	
	
	var fieldsToReplace = [];
	//Replace of dateTime with timezone based in sql needs to be done after, can not be done in qbselect
	if(isPostgresDB(dbName)) {
		for (d = 0; d < dataProviderIds.length; d++) {
			//When timestamp make it return UTC so it will be imported correctly
			if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.DATETIME) {
				fieldsToReplace.push("timezone('UTC', timezone('UTC',"+jsTable.getSQLName() + "." + dataProviderIds[d]+ ")) AS " + dataProviderIds[d]);
				dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[d]),'%%' + (fieldsToReplace.length - 1) + '%%')
			} else if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.MEDIA) {
				fieldsToReplace.push("encode("+jsTable.getSQLName() + "." + dataProviderIds[d]+ ", 'base64') AS " + dataProviderIds[d]);
				dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[d]),'%%' + (fieldsToReplace.length - 1) + '%%')
			}
		}
		dbSQL += ' LIMIT ? OFFSET ?';
	} else if(isMicrosoftDB(dbName)) {
		for (d = 0; d < dataProviderIds.length; d++) {
			//When timestamp make it return UTC so it will be imported correctly
			if(jsTable.getColumn(dataProviderIds[d]).getType() == JSColumn.DATETIME) {
				fieldsToReplace.push(jsTable.getSQLName() + "." + dataProviderIds[d]+ " AT TIME ZONE 'UTC' AS " + dataProviderIds[d]);
				dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[d]),'%%' + (fieldsToReplace.length - 1 )+ '%%')
			}
		}
		
		dbSQL += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;';
	} else if (!isProgressDB(dbName)) {		// OFFSET AND FETCH for Progress DB is added when running the query
		// Unsupported BD
		return null;
	}
	
	//Doing replace at the and / in 2 steps to fix issue with fields that match 2 times because of naming.
	fieldsToReplace.forEach(function(item, index) {
		dbSQL = dbSQL.replace('%%' + index + '%%',item);
	})
	
	return {query: dbSQL, cntQuery: cntSql, args: queryArgs, largeDataFields: largeTxtFields};
}


/**
 * @private 
 * @param {String} dbName
 * @param {Array<*>} args
 * @param {Number} offset
 * @param {Boolean} largeDataField
 * @param {Number} [limitTableCount] optional integer value to limit the number of records returned per table, useful for getting sample data
 * 
 * @return {Array<*>}
 *
 * @properties={typeid:24,uuid:"1072416E-CDA0-419A-A8EB-BB14A4A939F4"}
 */
function addOffsetArgs(dbName, args, offset, largeDataField, limitTableCount) {
	var limitValue = 20000;
	if(largeDataField) {
		limitValue = 100
	}
	if (limitTableCount) {
		limitValue = Math.min(limitValue, limitTableCount);
	}
	if(isPostgresDB(dbName)) {
		return args.concat([limitValue, offset])
	} else if(isMicrosoftDB(dbName) || isProgressDB(dbName)) {
		return args.concat([offset, limitValue]);
	} else {
		return null;
	}
}
/**
 * @public
 * @param {String} selectedDB
 * @param {String} [customPathToSVYQapaas]
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @param {Array<{fieldName: String, value: String|Number, [required]:Boolean}>} [additionalFilters] when given the query will add this to the where class (when field exists)
 * 			Fieldname: The DB Field that needs to be filtered
 * 			Value: The filter value
 * 			Required: Default false, when required it true and the field is missing in the table it will skip the table
 * @param {Boolean} [runFullTableRecalc] optional boolean to do a full table recalc when having storedcalcs.. will be heavy when there is a lot of data
 * @param {Number} [limitTableCount] optional integer value to limit the number of records returned per table, useful for getting sample data
 * @param {Boolean} [noZip] optional when true the export files will not be zipped, the folder with  plain csv will be part of the repository (do not use with large dataseed files)
 * @param {Array<String>} [excludeTableNames] Array with table names to filter for export, it has support for % as wildcard.
 * @return {plugins.file.JSFile} zipped dataseed file
 *
 * @properties={typeid:24,uuid:"67C8AFB5-1DE1-43D0-BFA9-4AFBDFFB50E3"}
 */
function createDataSeedFile(selectedDB, customPathToSVYQapaas, returnDataseedFile, additionalFilters, runFullTableRecalc, limitTableCount, noZip, excludeTableNames) {
	var zip = null;
	if (!selectedDB) {
		return zip;
	}
	
	if(returnDataseedFile == undefined) {
		returnDataseedFile = application.isInDeveloper();
	}
	excludeTableNames = (excludeTableNames == undefined ? excludeTableNames = ['temp_%'] : excludeTableNames.push('temp_%'));
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
		
		if(excludeTableNames && excludeTableNames.length > 0) {
			var matchedFilters = excludeTableNames.filter(/**@param {String} excludeTable */function(excludeTable) {
				if(table == excludeTable) {
					return true;
				} else if((excludeTable.startsWith('%') && excludeTable.endsWith('%')) && table.includes(excludeTable.replace(/%/g,''))) {
					return true;
				} else if(excludeTable.endsWith('%') && table.startsWith(excludeTable.replace(/%/g,''))) {
					return true;
				} else if(excludeTable.startsWith('%') && table.endsWith(excludeTable.replace(/%/g,''))) {
					return true
				} else {
					return false;
				}
			});
			
			if(matchedFilters.length > 0) {
				continue;
			}
		}
		
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
		if(queryObj instanceof Boolean && queryObj == false) {
			application.output("Skipping table: " + jsTable.getDataSource() + " additional filter added with required flag column not found", LOGGINGLEVEL.DEBUG);
			continue
		}
		var tableCount = databaseManager.getDataSetByQuery(queryObj.cntQuery,1).getValue(1,1);
		if (limitTableCount) {
			tableCount = Math.min(tableCount, limitTableCount);
		}
		
		var offset = 0;
		var exportFile = plugins.file.convertToJSFile(tempFolder + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '.csv');
		var fileWriter = new scopes.svyIO.BufferedWriter(exportFile,true)
		application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + tableCount + ') -start-');
		if(runFullTableRecalc) {
			var hasStoredCalcs = false;
			var calcs = solutionModel.getDataSourceNode(jsTable.getDataSource()).getCalculations();
			for(var i in calcs) {
				if(calcs[i].isStored()) {
					hasStoredCalcs = true;
					break;
				}
			}
			
			if(hasStoredCalcs) {
				fs.loadAllRecords()
				databaseManager.recalculate(fs);
				databaseManager.saveData(fs);
			}
			
			//Check if there is a onRecordUpdate method.. if so call that one... to always get the correct data;
			if(solutionModel.getDataSourceNode(jsTable.getDataSource()).getMethods().indexOf('onRecordUpdate') != -1) {
				fs.forEach(function(record) {
					fs['onRecordUpdate'](record);
				})
			}
		}
		do {
			var queryTime = new Date();
			/** @type {Array} */
			var args = addOffsetArgs(selectedDB,queryObj.args,offset, queryObj.largeDataFields, limitTableCount);
			/** @type {String} */
			var query = queryObj.query;
			
			// OpenEdge driver throws exception using parameters for OFFSET AND FETCH, 
			// add the values directly to the query and remove them from args
			if (isProgressDB(selectedDB)) {
				query += ' OFFSET ' + args[args.length - 2] + ' ROWS FETCH NEXT ' + args[args.length - 1] + ' ROWS ONLY';
				args.splice(args.length - 2, 2);
			}
			
			var dataset = databaseManager.getDataSetByQuery(selectedDB,query,args,-1);
			var csvHeader = (offset == 0 ? true : false);
			offset += dataset.getMaxRowIndex();
			application.output('Export of table: ' + selectedDB + ' / ' + table + ' (getting/parsing offset: ' + offset + ', querytime: ' + (new Date().getTime() - queryTime.getTime()) + 'ms ) -running-', LOGGINGLEVEL.DEBUG);
			fileWriter.write(dataset.getAsText(',','\r\n','"',csvHeader));
			dataset = null;
		} while (offset < tableCount && offset < 100000); //TODO: LIMIT SHOULD BE REMOVED!!
		fileWriter.close();
		application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + offset + ') -done-');
	}

	if(plugins.file.convertToJSFile(tempFolder).listFiles().length > 0) {
		if(noZip) {
			plugins.file.deleteFolder(plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB),false);
			plugins.file.copyFolder(plugins.file.convertToJSFile(tempFolder),plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB));
			zip = plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB);
		} else {
			zip = scopes.svyIO.zip(plugins.file.convertToJSFile(tempFolder), plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB + '.zip'));
		}
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
	 * @type {plugins.file.JSFile}
	 */
	this.remoteFile = (file instanceof plugins.file.JSFile ? file : null);
	
	
	/**
	 * @public  
	 * @type {String}
	 */
	this.fileName = (file instanceof JSMedia ? file.getName().split('/').pop() : file.getName())

	/**
	 * @public  
	 * @type {String}
	 */
	this.isZipFile = this.fileName.endsWith('.zip');
	
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
	
	/**
	 * @public
	 * @type {plugins.file.JSFile}  
	 */
	this.unzipDirectory = null;
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
			} else if(media.getName().match('.csv')){
				existingDataseeds.push(new DataseedFile(media, splitString[splitString.length -2]));
			}
		}
	}
	return existingDataseeds;
}

/**
 * @param {Boolean} [clearTablesNotInSeed] (Default: False) optional Clear all tables that are not in the dataseed zip file of the db server.
 * @param {plugins.file.JSFile} [dataseedFile] file to import instead of all files from media
 * @param {String} [dbNameToImport] databaseName to import the given dataseedfile (only works when other param is set)
 * @param {Boolean} [executeInTransaction] (Default: False) When true execution will be done in an single db transaction
 * @param {Boolean} [deleteExistingData] (Default: True) When true existing data in tables will be cleared
 * @public
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia(clearTablesNotInSeed, dataseedFile, dbNameToImport, executeInTransaction, deleteExistingData) {
	// Set default values
	deleteExistingData = !!deleteExistingData ? true : false;
	executeInTransaction = !!executeInTransaction ? false : true;
	clearTablesNotInSeed = !!clearTablesNotInSeed ? false : true;
	
	var file, tableName
	/**@type {Array<DataseedFile>} */
	var mediaList = (dataseedFile  && dbNameToImport ? [new DataseedFile(dataseedFile,dbNameToImport)] :  getExistingDataseeds());
	var seededTables = {};
	var jsTable
	var systemProperties = scopes.svySystem.getSystemProperties();
	
	mediaList = mediaList.sort(/**  @param {DataseedFile} a 
						@param {DataseedFile} b */ function(a, b) {
		return a.dbName.localeCompare(b.dbName)
	})
	
	/**@type {Array<plugins.file.JSFile>} */
	var foldersToImport = [];
	for each (var importFile in mediaList) {
		if(importFile.isZipFile) {
			file = plugins.file.createTempFile('', '.zip');
			if(importFile.remoteFile) {
				plugins.file.copyFile(importFile.remoteFile, file);
			} else {
				plugins.file.writeFile(file, importFile['getBytes']());
			}
			importFile.unzipDirectory = scopes.svyIO.unzip(file);
			 
		} else {
			if(foldersToImport.indexOf(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName) == -1) {
				plugins.file.createFolder(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName);
				importFile.unzipDirectory = plugins.file.convertToJSFile(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName);
				foldersToImport.push(importFile.unzipDirectory)
			}
			file = plugins.file.createFile(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName + systemProperties.fileSeparator + importFile.fileName);
			plugins.file.writeFile(file, importFile['getBytes']());
		}
	}
	
	mediaList.forEach(/**@param {DataseedFile} mediaItem */ function(mediaItem) {
		if (mediaItem.unzipDirectory && mediaItem.unzipDirectory.isDirectory()) {
			var zipContent = plugins.file.getFolderContents(mediaItem.unzipDirectory);
			for(var i = 1 ; i <= 5; i++) {
				zipContent.forEach(/**@param {plugins.file.JSFile} folderItem */ function(folderItem) {
					if (folderItem.isFile() && folderItem.getName().match('.csv')) {
						tableName = folderItem.getName().replace('.csv', '');
						jsTable = databaseManager.getTable(mediaItem.dbName, tableName);
						if (!jsTable) {
							application.output("Skipping table: " + mediaItem.dbName + "." + tableName + " - table not found", LOGGINGLEVEL.DEBUG);
							return;
						}
						if(deleteExistingData == true) {
							if (isMicrosoftDB(mediaItem.dbName) || isProgressDB(mediaItem.dbName)) {
								executeQuery(mediaItem.dbName,jsTable,['delete from ' + jsTable.getQuotedSQLName() + ';']);
							} else {
								executeQuery(mediaItem.dbName,jsTable,['TRUNCATE TABLE ' + jsTable.getQuotedSQLName() + ' CASCADE;']);
							}
						}
					}
				})
			}
			if(executeInTransaction == true) {
				databaseManager.startTransaction();
			}
			
			zipContent.forEach(/**@param {plugins.file.JSFile} folderItem */ function(folderItem) {
				if (folderItem.isFile() && folderItem.getName().match('.csv')) {
					tableName = folderItem.getName().replace('.csv', '');
					importCsvFile(mediaItem.dbName, tableName, folderItem);
					if(!seededTables[mediaItem.dbName]) {
						seededTables[mediaItem.dbName] = new Array();
					}
					seededTables[mediaItem.dbName].push(tableName);
				}
			})
			
			if(executeInTransaction == true) {
				databaseManager.commitTransaction(true,false);
			}
		}
		
		plugins.file.deleteFolder(mediaItem.unzipDirectory, false);	
	});

	if(clearTablesNotInSeed == true) {
		Object.keys(seededTables).forEach(/** @param {String} dbName */ function(dbName) {
			var tables = databaseManager.getTableNames(dbName);
			for each(var table in tables) {
				if(seededTables[dbName].indexOf(table) == -1) {
					jsTable = databaseManager.getTable(dbName, table);
					if (jsTable.isMetadataTable()) {
						application.output("Skipping clearing metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
					} else if(Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) { 
						application.output("Skipping clearing i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
					} else {
						if (isMicrosoftDB(dbName)) {
							executeQuery(dbName,jsTable,['delete from ' + jsTable.getQuotedSQLName() + ';']);
						} else {
							executeQuery(dbName,jsTable,['TRUNCATE TABLE ' + jsTable.getQuotedSQLName() + ' CASCADE;']);
						}
					}
				}
			}
		})
	}
}

/**
 * @private
 * @param {String} dbName
 * @param {String} tableName
 * @param {plugins.file.JSFile} file
 * @return {Boolean}
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
	var quoteCharRegex = new RegExp(escapeRegExp('"') + escapeRegExp('"'), 'g');
	
	/** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions */
	function escapeRegExp(string)
	{
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
	}
	
	/**@param {{columnNames: Array, data: Array, errors: Array, meta: {delimiter: String, linebreak: String, aborted: Boolean, truncated: Boolean, cursor: Number}}} csvData */
	function importData(csvData) {
		if (table) {
			//Assume it is the first line, so do init calles;
			if (header.length == 0) {
				header = csvData.columnNames;
				fullHeader = header;

				// verify the header columns
				columnDiffs = getTableSchemaDiff(table, header);
				if (columnDiffs.length) {
					application.output('Table: ' + tableName + ' has more column in export then in table; the following columns don\'t exists in table: ' + columnDiffs.join(','), LOGGINGLEVEL.WARNING);
				}
				
				//Clear header with missing columns
				header = header.filter(function(item) {
					return (columnDiffs.indexOf(item) === -1)
				}).map(function(col) {
					// Quote column name only if needed, Progress supports special chars ($, %, #, -) that need to be quoted
					// TODO Add more special chars to the regex as needed
					return /[\$\-%#]/.test(col) ? '"' + col + '"' : col
				})

			} 
			
			csvData.data.forEach(function(rowData) {
				if (rowData) {
					counter++;
					if (rowData != undefined) {
						rowData = rowData.filter(function(item,index) {
							for(var i in columnDiffs) {
								if(fullHeader.indexOf(columnDiffs[i]) == index) {
									return false;
								}
							}
							return true;
						})
						/** @type {Array<*>} */
						var values = rowData.map(
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
											newDate = utils.dateFormat(utils.parseDate(value,'yyyy-MM-dd HH:mm:ss', 'UTC'), 'yyyy-MM-dd HH:mm:ss', 'UTC');
											if(newDate) {
												return "'" + newDate + "'"; 
											}
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
									if(value) {
										return "decode('" + value + "', 'base64')";
									} else {
										return 'NULL';
									}
								break;
								default:
									if(!value && column.getAllowNull()){
										return 'NULL';
									} else {
										if(value && value.length > column.getLength()) {
											value = value.substr(0,column.getLength())
										}
										return "'" + utils.stringReplace(value||"", "'", "''").replace(quoteCharRegex,'"') + "'";
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
				}
			})
		} else {
			application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / table not found on server!!-', LOGGINGLEVEL.INFO);
		}
		return true;
	}

	application.output('Import of file: ' + dbName + ' / ' + tableName + ' -Started-', LOGGINGLEVEL.INFO);
	
	scopes.svyDataUtils.parseCSV(plugins.file.readTXTFile(file,'UTF-8'), {delimiter: ',', firstRowHasColumnNames: true, textQualifier: '"'}, importData);
	
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
 *  
 * @param {String} dbName
 * @param {JSTable} table
 * @param {Array<String>} queryToExec
 * 
 * @return {Boolean}
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
	} else if(isPostgresDB(dbName)) {
		if(table.getRowIdentifierColumnNames().length > 0 && table.getColumn(table.getRowIdentifierColumnNames()[0]).getSequenceType() == JSColumn.DATABASE_SEQUENCE && table.getColumn(table.getRowIdentifierColumnNames()[0]).getType() == JSColumn.INTEGER) {
			queryToExec.push("SELECT setval(pg_get_serial_sequence('" + table.getSQLName() + "', '"+ table.getColumn(table.getRowIdentifierColumnNames()[0]).getQuotedSQLName()+ "'), COALESCE(CAST(max(" + table.getColumn(table.getRowIdentifierColumnNames()[0]).getQuotedSQLName()+ ") AS INT), 1)) FROM " + table.getQuotedSQLName() + ";");
		}
	} else if(isProgressDB(dbName)) {
		// TODO Implement support to import into a Progress DB
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

/**
 * @private
 * 
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"4C156C85-F555-4E1F-BF08-F03ED3A279B0"}
 */
function isProgressDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('openedge') ? true : false;
}