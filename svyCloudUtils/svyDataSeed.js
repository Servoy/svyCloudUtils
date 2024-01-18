/**
 * @type {{postgres: {[dbname]: Boolean}, mssql: {[dbname]: Boolean}, openedge: {[dbname]: Boolean}}}
 * @protected
 * @properties={typeid:35,uuid:"48DEE521-2E18-4F06-870A-E4BFA8680D06",variableType:-4}
 */
var DB_CACHE = {
    postgres: {},
    mssql: {},
    openedge: {}
}

/**
 * @protected
 * @type {Boolean}
 * @properties={typeid:35,uuid:"62E3253C-3404-48EA-9345-8F5BE6D3B5DD",variableType:-4}
 */
var hasAsyncCall = false;

/**
 * @protected 
 * @properties={typeid:35,uuid:"374F753E-86A9-4518-A67A-E571F20A9AB3",variableType:-4}
 */
var servoyVersionNumber = utils.stringToNumber(application.getVersion().trim().split('.').map(function(value) {return (value.length < 2 ? ("0" + value) : value)}).join(''));
/**
 * @private
 * @return {String}
 *
 * @properties={typeid:24,uuid:"960218D4-695E-4D1E-8472-7AD7AC9B5F99"}
 */
function getWorkspacePath() {
    var workspacePath = java.lang.System.getProperty("osgi.instance.area");
    //Can't use scopes.svySystem.. that is also controlled by browser
    if (/Windows/.test(scopes.svySystem.getSystemProperties().osName)) {
        return workspacePath.substr(6, workspacePath.length);
    } else {
        return workspacePath.substr(5, workspacePath.length);
    }
}

/**
 * @protected 
 * @type {{value: Number, size: String}}
 * @properties={typeid:35,uuid:"04D55C2F-7533-4746-AC75-D8C0EFDA37BC",variableType:-4}
 */
var currentWorkMem = null

/**
 * @public 
 * @param {String} dbName
 * @return {{value: Number, size: String}}
 * @properties={typeid:24,uuid:"673DEB5E-2DCB-4061-8D02-778A82A43FD7"}
 */
function getCurrentWorkMem(dbName) {
	if(!currentWorkMem) {
        var workMem = databaseManager.getDataSetByQuery(dbName,"SELECT current_setting('work_mem');",[],-1).getValue(1,1);
        var workMemValue = parseInt(workMem.split(/\D+/)[0]);
        var workMemSize = workMem.split(/\d+/)[1];
        
        currentWorkMem =  {value: workMemValue, size: workMemSize};
	}
	return currentWorkMem;
}

/**
 * @public
 * @param {String} [customPathToSvyCloudUtils]
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @param {Boolean} [runFullTableRecalc] optional boolean to do a full table recalc when having storedcalcs.. will be heavy when there is a lot of data
 * @param {Boolean} [noZip] optional when true the export files will not be zipped, the folder with  plain csv will be part of the repository (do not use with large dataseed files)
 * @param {Array<String>} [excludeTableNames] Array with table names to filter for export, it has support for % as wildcard
 * @param {RegExp} [columnNameRegex] optional regex check to improve performance of column data check, csv can't have linebreaks etc, so we convert data when we find that in the content. When this regex matches on columnname it will ignore that check
 * @return {plugins.file.JSFile} zipped dataseed file
 *
 * @properties={typeid:24,uuid:"B89674BA-49DE-4B32-829B-2181B69D44A5"}
 */
function createDataSeedFiles(customPathToSvyCloudUtils, returnDataseedFile, runFullTableRecalc, noZip, excludeTableNames, columnNameRegex) {
    var databases = [];
    datasources['db']['allnames'].forEach(function (item) {
        if (item != 'repository_server') {
            databases.push(item.toString());
        }
    })
    var selectedDB = plugins.dialogs.showSelectDialog('Generate dataseed', 'Select DB to generate dataseed from', databases);
    return createDataSeedFile(selectedDB, customPathToSvyCloudUtils, returnDataseedFile, null, runFullTableRecalc, null, noZip, excludeTableNames, columnNameRegex);
}

/**
 * @public
 * @param {String|Boolean} dataseedToRemove Dataseed to Remove, boolean true will remove all
 * @param {String} [customDataseedPath]
 * @properties={typeid:24,uuid:"EA5C78EC-8BD9-47AB-B45C-AF24BBC470B7"}
 */
function removeExistingDataSeedFile(dataseedToRemove, customDataseedPath) {
    var workspacePath = application.isInDeveloper() ? getWorkspacePath() : scopes.svySystem.getSystemProperties().javaIoTmpdir;
    var dbFolderPathArray = [workspacePath, 'svyCloudUtils', 'medias', 'dataseeds'];
    if (customDataseedPath) {
        dbFolderPathArray = [customDataseedPath, 'medias', 'dataseeds'];
    }

    if (dataseedToRemove instanceof Boolean) {
        plugins.file.deleteFolder(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()), false);
    } else {
        dbFolderPathArray.push(dataseedToRemove.toString());
        plugins.file.deleteFolder(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()), false);
        plugins.file.deleteFile(dbFolderPathArray.join(scopes.svyIO.getFileSeperator()) + '.zip');
    }
}

/**
 * @protected 
 * @param {JSTable} jsTable
 * @return {String}
 * @properties={typeid:24,uuid:"2428C9C2-113D-46B1-83A1-77A65D2DEA7A"}
 */
function getJSTablePKColumn(jsTable) {
	var PKColumn;
	if(jsTable.getRowIdentifierColumnNames().length > 1) {
		PKColumn = jsTable.getRowIdentifierColumnNames().sort().filter(function(item) {return item.endsWith('_uuid') || item.endsWith('_id')})[0];
		if(!PKColumn) {
			PKColumn = jsTable.getRowIdentifierColumnNames().sort()[0];
		}
	} else {
		PKColumn = jsTable.getRowIdentifierColumnNames()[0];
	}
	return PKColumn;
}

/**
 * @private
 * @param {String} dbName
 * @param {JSTable} jsTable
 * @param {Array<{fieldName: String, value: String|Number, [required]:Boolean}>} [additionalFilters]
 * @param {RegExp} [columnNameRegex]
 * @return {{query: String, cntQuery: QBSelect, args: Array<*>, largeDataFields: Boolean, base64Fields:Array<String>}|Boolean}
 * @properties={typeid:24,uuid:"F6B909B6-76E3-48A2-9A57-9728EC843BB4"}
 */
function buildSelectSQL(dbName, jsTable, additionalFilters, columnNameRegex) {
    var largeTxtFields = false;
    var dataProviderIds = jsTable.getColumnNames();
    var base64Fields = [];
    var sql = databaseManager.createSelect(jsTable.getDataSource());
    for (var dpidindex = 0; dpidindex < dataProviderIds.length; dpidindex++) {
        if (jsTable.getColumn(dataProviderIds[dpidindex]).getType() != JSColumn.MEDIA || isPostgresDB(dbName)) {
            sql.result.add(sql.columns[dataProviderIds[dpidindex]]);
        } else if (jsTable.getColumn(dataProviderIds[dpidindex]).getType() == JSColumn.MEDIA && isMicrosoftDB(dbName)) {
            application.output("Found media column, media conversion isn't supported currently for MSSQL Server. Column will be skipped", LOGGINGLEVEL.WARNING)
        }

        if (jsTable.getColumn(dataProviderIds[dpidindex]).getLength() > 10000 || jsTable.getColumn(dataProviderIds[dpidindex]).getType() == JSColumn.MEDIA) {
            largeTxtFields = true;
        }
    }

    //Add sort to have a better offset && not have duplicates because of offset
    sql.sort.add(sql.columns[getJSTablePKColumn(jsTable)].asc);    	

    var cntSql = databaseManager.createSelect(jsTable.getDataSource());
    cntSql.result.clear();
    cntSql.result.add(cntSql.getColumn(getJSTablePKColumn(jsTable)).count);

    if (additionalFilters) {
        for (var additionalFilterIndex in additionalFilters) {
            var filter = additionalFilters[additionalFilterIndex];
            if (jsTable.getColumn(filter.fieldName)) {
                sql.where.add(sql.columns[filter.fieldName].eq(filter.value)); //Add to the data query
                cntSql.where.add(cntSql.columns[filter.fieldName].eq(filter.value)); //Add to countQuery
            } else {
                if (filter.hasOwnProperty('required') && filter.required === true) {
                    application.output("Skipping table: " + jsTable.getDataSource() + " additional filter added with required flag column (" + filter.fieldName + ") not found", LOGGINGLEVEL.INFO);
                    return false;
                }
            }
        }
    }

    //Instead of LIMIT & OFFSET we use sort
    //UUID Will be removed from the argument list
    if(!isProgressDB(dbName)) {
    	sql.where.add(sql.columns[getJSTablePKColumn(jsTable)].gt(application.getUUID()));
    }
    
    //Parse to string & args array
    var dbSQL = sql.getSQL(false);
    var queryArgs = sql.getSQLParameters(false) || [];

    var fieldsToReplace = [];
    //Replace of dateTime with timezone based in sql needs to be done after, can not be done in qbselect
    if (isPostgresDB(dbName)) {
        for (var dpidindexps = 0; dpidindexps < dataProviderIds.length; dpidindexps++) {
            //When timestamp make it return UTC so it will be imported correctly
            if (jsTable.getColumn(dataProviderIds[dpidindexps]).getType() == JSColumn.DATETIME) {
                fieldsToReplace.push("timezone('UTC'," + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ") AS " + dataProviderIds[dpidindexps]);
                dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[dpidindexps]), '%%' + (fieldsToReplace.length - 1) + '%%')
            } else if (jsTable.getColumn(dataProviderIds[dpidindexps]).getType() == JSColumn.MEDIA) {
                fieldsToReplace.push("encode(" + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ", 'base64') AS " + dataProviderIds[dpidindexps]);
                dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[dpidindexps]), '%%' + (fieldsToReplace.length - 1) + '%%');
                base64Fields.push(dataProviderIds[dpidindexps]);
            } else if (jsTable.getColumn(dataProviderIds[dpidindexps]).getType() == JSColumn.TEXT && (Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getServer(dbName).getTableBySqlname(jsTable.getSQLName()).getColumn(dataProviderIds[dpidindexps]).getTextualPropertyInfo() || '').match('StringSerializer')) {
                base64Fields.push(dataProviderIds[dpidindexps]);
            } else if (jsTable.getColumn(dataProviderIds[dpidindexps]).getType() == JSColumn.TEXT && !jsTable.getColumn(dataProviderIds[dpidindexps]).hasFlag(JSColumn.UUID_COLUMN)) {
            	if(!columnNameRegex || !columnNameRegex.test(jsTable.getSQLName())) {
	                var lineSQL = 'SELECT ' + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ' FROM ' + jsTable.getSQLName() + ' WHERE (POSITION( chr(44) in ' + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ')<>0 OR POSITION( chr(13) in ' + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ')<>0 OR POSITION( chr(10) in ' + jsTable.getSQLName() + "." + dataProviderIds[dpidindexps] + ')<>0)';
	                if (additionalFilters) {
	                	for (var additionalFilterIndexToAdd in additionalFilters) {
	                        var additionalFilter = additionalFilters[additionalFilterIndexToAdd];
	                        if (jsTable.getColumn(additionalFilter.fieldName)) {
	                        	lineSQL += ' AND ' + jsTable.getColumn(additionalFilter.fieldName).getSQLName() + " = '" + additionalFilter.value + "'";
	                        }
                        }
	                }
	                if (databaseManager.getDataSetByQuery(jsTable.getServerName(), lineSQL, [], 1).getMaxRowIndex()) {
	                    application.output('Will encrypted column: ' + dataProviderIds[dpidindexps] + ' into base64, it has LF or CR or , in it.. what are special things in CSV');
	                    base64Fields.push(dataProviderIds[dpidindexps]);
	                }
            	}
            }
        }
        dbSQL += ' LIMIT ?';
    } else if (isMicrosoftDB(dbName)) {
        for (var dpidindexms = 0; dpidindexms < dataProviderIds.length; dpidindexms++) {
            //When timestamp make it return UTC so it will be imported correctly
            if (jsTable.getColumn(dataProviderIds[dpidindexms]).getType() == JSColumn.DATETIME) {
                fieldsToReplace.push(jsTable.getSQLName() + "." + dataProviderIds[dpidindexms] + " AT TIME ZONE 'UTC' AS " + dataProviderIds[dpidindexms]);
                dbSQL = dbSQL.replace((jsTable.getSQLName() + '.' + dataProviderIds[dpidindexms]), '%%' + (fieldsToReplace.length - 1) + '%%')
            }
        }

        dbSQL += ' OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY;';
    } else if (!isProgressDB(dbName)) { // OFFSET AND FETCH for Progress DB is added when running the query
        // Unsupported BD
        return null;
    }

    //Remove the dummy uuid for the where > then pk
    if(!isProgressDB(dbName)) {
    	queryArgs.pop();
    }
    //Doing replace at the and / in 2 steps to fix issue with fields that match 2 times because of naming.
    fieldsToReplace.forEach(function (item, index) {
        dbSQL = dbSQL.replace('%%' + index + '%%', item);
    })

    return {
        query: dbSQL,
        cntQuery: cntSql,
        args: queryArgs,
        largeDataFields: largeTxtFields,
        base64Fields: base64Fields
    };
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
    if (largeDataField) {
        limitValue = 500
    }
    if (limitTableCount) {
        limitValue = Math.min(limitValue, limitTableCount);
    }
    if (isPostgresDB(dbName) || isMicrosoftDB(dbName)) {
        return args.concat([limitValue])
    } else if (isProgressDB(dbName)) {
    	return args.concat([offset, limitValue]);
    } else {
        return null;
    }
}
/**
 * @public
 * @param {String} selectedDB
 * @param {String} [customPathToSvyCloudUtils]
 * @param {Boolean} [returnDataseedFile] when true, dataseed will not be written to workspace but return as jsFile
 * @param {Array<{fieldName: String, value: String|Number, [required]:Boolean}>} [additionalFilters] when given the query will add this to the where class (when field exists)
 * 			Fieldname: The DB Field that needs to be filtered
 * 			Value: The filter value
 * 			Required: Default false, when required it true and the field is missing in the table it will skip the table
 * @param {Boolean} [runFullTableRecalc] optional boolean to do a full table recalc when having storedcalcs.. will be heavy when there is a lot of data
 * @param {Number} [limitTableCount] optional integer value to limit the number of records returned per table, useful for getting sample data
 * @param {Boolean} [noZip] optional when true the export files will not be zipped, the folder with  plain csv will be part of the repository (do not use with large dataseed files)
 * @param {Array<String>} [excludeTableNames] Array with table names to filter for export, it has support for % as wildcard.
 * @param {RegExp} [columnNameRegex] optional regex check to improve performance of column data check, csv can't have linebreaks etc, so we convert data when we find that in the content. When this regex matches on columnname it will ignore that check
 * @return {plugins.file.JSFile} zipped dataseed file
 *
 * @properties={typeid:24,uuid:"67C8AFB5-1DE1-43D0-BFA9-4AFBDFFB50E3"}
 */
function createDataSeedFile(selectedDB, customPathToSvyCloudUtils, returnDataseedFile, additionalFilters, runFullTableRecalc, limitTableCount, noZip, excludeTableNames, columnNameRegex) {
    var zip = null;
    if (!selectedDB) {
        return zip;
    }

    if (returnDataseedFile == undefined) {
        returnDataseedFile = !application.isInDeveloper();
    }
    if (excludeTableNames == undefined) {
        excludeTableNames = ['temp_%'];
    } else {
        excludeTableNames.push('temp_%');
    }

    var workspacePath = returnDataseedFile ? scopes.svySystem.getSystemProperties().javaIoTmpdir : getWorkspacePath();
    var tables = databaseManager.getTableNames(selectedDB);
    var dbFolderPath = [workspacePath, 'svyCloudUtils', 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
    var tempFolder = [scopes.svySystem.getSystemProperties().javaIoTmpdir, 'temp_export'].join(scopes.svyIO.getFileSeperator());
    if (customPathToSvyCloudUtils) {
        dbFolderPath = [customPathToSvyCloudUtils, 'medias', 'dataseeds'].join(scopes.svyIO.getFileSeperator());
        tempFolder = [scopes.svySystem.getSystemProperties().javaIoTmpdir, 'temp_export'].join(scopes.svyIO.getFileSeperator());
    }

    removeExistingDataSeedFile(selectedDB, customPathToSvyCloudUtils);
    plugins.file.createFolder(dbFolderPath);
    plugins.file.deleteFolder(tempFolder, false);
    plugins.file.createFolder(tempFolder);

    for (var tableIndex in tables) {
        var table = tables[tableIndex];
        if (excludeTableNames && excludeTableNames.length > 0) {
            var matchedFilters = excludeTableNames.filter( /**@param {String} excludeTable */ function (excludeTable) {
                if (table == excludeTable) {
                    return true;
                } else if ((excludeTable.startsWith('%') && excludeTable.endsWith('%')) && table.includes(excludeTable.replace(/%/g, ''))) {
                    return true;
                } else if (excludeTable.endsWith('%') && table.startsWith(excludeTable.replace(/%/g, ''))) {
                    return true;
                } else if (excludeTable.startsWith('%') && table.endsWith(excludeTable.replace(/%/g, ''))) {
                    return true
                } else {
                    return false;
                }
            });

            if (matchedFilters.length > 0) {
                application.output("Skipping table because it is excluded: " + table, LOGGINGLEVEL.DEBUG);
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
            if (true) {
                continue;
            }
        }

        if (jsTable.isMetadataTable()) {
            application.output("Skipping metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
            continue;
        } else if (Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) {
            application.output("Skipping i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
            continue;
        }

        if(jsTable.getRowIdentifierColumnNames().length > 1) {
        	application.output('Table: ' + jsTable.getDataSource() + ' Multiple primary keys found. Will use column `' + getJSTablePKColumn(jsTable) +'` as the primary key column', LOGGINGLEVEL.WARNING);
        }

        var queryObj = buildSelectSQL(selectedDB, jsTable, additionalFilters, columnNameRegex);
        if (queryObj instanceof Boolean && !queryObj) {
            application.output("Skipping table: " + jsTable.getDataSource() + " additional filter added with required flag column not found", LOGGINGLEVEL.DEBUG);
            continue;
        }
        
        var tableCount = databaseManager.getDataSetByQuery(queryObj.cntQuery, 1).getValue(1, 1);
        if (limitTableCount) {
            tableCount = Math.min(tableCount, limitTableCount);
        }

        var offset = 0;
        var lastQueryResultPK;
		if(jsTable.getColumn(getJSTablePKColumn(jsTable)).getType() != JSColumn.UUID_COLUMN && !jsTable.getColumn(getJSTablePKColumn(jsTable)).hasFlag(JSColumn.UUID_COLUMN)) {
			lastQueryResultPK = '';
		} else {
			if(servoyVersionNumber <= 20230600) {
				lastQueryResultPK = application.getUUID('00000000-0000-0000-0000-00000000000').toString()
			} else {
				lastQueryResultPK = application.getUUID('00000000-0000-0000-0000-00000000000')
			}
		}
        var exportFile = plugins.file.convertToJSFile(tempFolder + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '.csv');
        var fileWriter = new scopes.svyIO.BufferedWriter(exportFile, true);
        var numberOfFileCounter = 1;
        var timeTrackingTable = new Date();
        application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + tableCount + ') -start-');
        if (runFullTableRecalc) {
            var hasStoredCalcs = false;
            var calcs = solutionModel.getDataSourceNode(jsTable.getDataSource()).getCalculations();
            for (var i in calcs) {
                if (calcs[i].isStored()) {
                    hasStoredCalcs = true;
                    break;
                }
            }

            if (hasStoredCalcs) {
                fs.loadAllRecords()
                databaseManager.recalculate(fs);
                databaseManager.saveData(fs);
            }

            //Check if there is a onRecordUpdate method.. if so call that one... to always get the correct data;
            if (solutionModel.getDataSourceNode(jsTable.getDataSource()).getMethods().indexOf('onRecordUpdate') != -1) {
                fs.forEach(function (record) {
                    fs['onRecordUpdate'](record);
                })
            }
        }
        do {
            var queryTime = new Date();
            /** @type {Array} */
            var args = JSON.parse(JSON.stringify(queryObj.args));
            if(!isProgressDB(selectedDB)) {
        		args.push(lastQueryResultPK);
            }
            args = addOffsetArgs(selectedDB, args, offset, queryObj.largeDataFields, limitTableCount);
            /** @type {String} */
            var query = queryObj.query;

            // OpenEdge driver throws exception using parameters for OFFSET AND FETCH,
            // add the values directly to the query and remove them from args
            if (isProgressDB(selectedDB)) {
                query += ' OFFSET ' + args[args.length - 2] + ' ROWS FETCH NEXT ' + args[args.length - 1] + ' ROWS ONLY';
                args.splice(args.length - 2, 2);
            }
            var dataset = databaseManager.getDataSetByQuery(selectedDB, query, args, -1);
            var csvHeader = (offset == 0 ? true : false);
            offset += dataset.getMaxRowIndex();
            
    		if(jsTable.getColumn(getJSTablePKColumn(jsTable)).getType() != JSColumn.UUID_COLUMN && !jsTable.getColumn(getJSTablePKColumn(jsTable)).getType() != JSColumn.TEXT && !jsTable.getColumn(getJSTablePKColumn(jsTable)).hasFlag(JSColumn.UUID_COLUMN)) {
    			lastQueryResultPK = dataset.getValue(dataset.getMaxRowIndex(), dataset.getColumnNames().indexOf(getJSTablePKColumn(jsTable)) + 1);
    		} else {
    			if(servoyVersionNumber <= 20230600) {
    				lastQueryResultPK = application.getUUID(dataset.getValue(dataset.getMaxRowIndex(), dataset.getColumnNames().indexOf(getJSTablePKColumn(jsTable)) + 1)).toString()
    			} else {
    				lastQueryResultPK = application.getUUID(dataset.getValue(dataset.getMaxRowIndex(), dataset.getColumnNames().indexOf(getJSTablePKColumn(jsTable)) + 1))
    			}
    		}
    		
            if (queryObj.base64Fields.length) {
                /**@type {Array<String>} */
                var fields = dataset.getColumnNames();
                fields.forEach(
                    /**	@param {String} fieldName
                                      @param {Number} colIndex */
                    function (fieldName, colIndex) {
                        if (queryObj.base64Fields.indexOf(fieldName) != -1) {
                            for (var dsIndex = 1; dsIndex <= dataset.getMaxRowIndex(); dsIndex++) {
                                var parsedValue = dataset.getValue(dsIndex, (colIndex + 1))
                                if (parsedValue) {
                                    parsedValue = 'base64:' + utils.stringToBase64(parsedValue);
                                    dataset.setValue(dsIndex, (colIndex + 1), parsedValue);
                                }
                            }
                        }
                    })
            }
            application.output('Export of table: ' + selectedDB + ' / ' + table + ' (getting/parsing offset: ' + offset + ', querytime: ' + (new Date().getTime() - queryTime.getTime()) + 'ms, tableRows: ' + tableCount + ' ) -running-', LOGGINGLEVEL.DEBUG);

            if (plugins.file.getFileSize(exportFile) > 200000000) {
                fileWriter.close();
                numberOfFileCounter++;
                exportFile = plugins.file.convertToJSFile(tempFolder + scopes.svyIO.getFileSeperator() + jsTable.getSQLName() + '#' + numberOfFileCounter + '.csv');
                fileWriter = new scopes.svyIO.BufferedWriter(exportFile, true)
                fileWriter.write(dataset.getAsText(',', '\r\n', '"', true));
            } else {
                fileWriter.write(dataset.getAsText(',', '\r\n', '"', csvHeader));
            }

        } while (offset < tableCount);
        fileWriter.close();
        application.output('Export of table: ' + selectedDB + ' / ' + table + ' (rows: ' + tableCount + ', totalTime: ' + (new Date().getTime() - timeTrackingTable.getTime()) + 'ms) -done-');
    }

    if (plugins.file.convertToJSFile(tempFolder).listFiles().length > 0) {
        if (noZip) {
            plugins.file.deleteFolder(plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB), false);
            plugins.file.copyFolder(plugins.file.convertToJSFile(tempFolder), plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB));
            zip = plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB);
        } else {
        	if(plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB + '.zip').exists()) {
        		plugins.file.convertToJSFile(dbFolderPath + scopes.svyIO.getFileSeperator() + selectedDB + '.zip').deleteFile();
        	}
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
    this.getBytes = function () {
        if (file instanceof JSMedia) {
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

    /**
     * @public
     */
    this.clearRemoteFileRef = function () {
        this.remoteFile = null;
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
    solutionModel.getMediaList().forEach( /**@param {JSMedia} media */ function (media) {
        if (media && media.getName().match('dataseeds')) {
            var splitString = media.getName().split('/');
            if (media.getName().match('.zip')) {
                existingDataseeds.push(new DataseedFile(media, splitString.pop().replace('.zip', '')));
            } else if (media.getName().match('.csv')) {
                existingDataseeds.push(new DataseedFile(media, splitString[splitString.length - 2]));
            }
        }
    })
    return existingDataseeds;
}

/**
 * @param {Boolean} [clearTablesNotInSeed] (Default: False) optional Clear all tables that are not in the dataseed zip file of the db server.
 * @param {plugins.file.JSFile|JSMedia} [dataseedFile] file to import instead of all files from media
 * @param {String} [dbNameToImport] databaseName to import the given dataseedfile (only works when other param is set)
 * @param {Boolean} [executeInTransaction] (Default: False) When true execution will be done in an single db transaction
 * @param {Boolean} [deleteExistingData] (Default: True) When true existing data in tables will be cleared
 * @param {Function} [statusCallBackFunction]
 * @public
 * @properties={typeid:24,uuid:"9E1D40BE-49BB-401D-85FF-B4E5FF920547"}
 */
function runDataseedFromMedia(clearTablesNotInSeed, dataseedFile, dbNameToImport, executeInTransaction, deleteExistingData, statusCallBackFunction) {
    // Set default values
    deleteExistingData = deleteExistingData == undefined || deleteExistingData == null ? true : deleteExistingData;
    executeInTransaction = executeInTransaction == undefined || executeInTransaction == null ? false : executeInTransaction;
    clearTablesNotInSeed = clearTablesNotInSeed == undefined || clearTablesNotInSeed == null ? false : clearTablesNotInSeed;

    var file, tableName
    /**@type {Array<DataseedFile>} */
    var mediaList = (dataseedFile && dbNameToImport ? [new DataseedFile(dataseedFile, dbNameToImport)] : getExistingDataseeds());
    var seededTables = {};
    var jsTable
    var systemProperties = scopes.svySystem.getSystemProperties();

    mediaList = mediaList.sort(
        /**  @param {DataseedFile} a
              @param {DataseedFile} b */
        function (a, b) {
            return a.dbName.localeCompare(b.dbName)
        })

    /**@type {Array<plugins.file.JSFile>} */
    var foldersToImport = [];
    for (var mediaListIndex in mediaList) {
        var importFile = mediaList[mediaListIndex];
        if (importFile.isZipFile) {
            file = plugins.file.createTempFile('', '.zip');
            if (importFile.remoteFile) {
                plugins.file.copyFile(importFile.remoteFile, file);
            } else {
                plugins.file.writeFile(file, importFile.getBytes());
            }
            importFile.unzipDirectory = scopes.svyIO.unzip(file);
            file.deleteFile();

        } else {
            if (foldersToImport.indexOf(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName) == -1) {
                plugins.file.createFolder(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName);
                importFile.unzipDirectory = plugins.file.convertToJSFile(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName);
                foldersToImport.push(importFile.unzipDirectory)
            }
            file = plugins.file.createFile(systemProperties.javaIoTmpdir + systemProperties.fileSeparator + importFile.dbName + systemProperties.fileSeparator + importFile.fileName);
            plugins.file.writeFile(file, importFile.getBytes());
        }
        importFile.clearRemoteFileRef();
        file = null;
    }

    mediaList.forEach( /**@param {DataseedFile} mediaItem */ function (mediaItem) {
        if (mediaItem.unzipDirectory && mediaItem.unzipDirectory.isDirectory()) {
            var zipContent = plugins.file.getFolderContents(mediaItem.unzipDirectory);
            zipContent.sort(function sortFunction(a, b) {
                return a.getName().localeCompare(b.getName())
            })
            for (var i = 1; i <= 5; i++) {
                zipContent.forEach( /**@param {plugins.file.JSFile} item */ function (item) {
                    if (item.isFile() && item.getName().match('.csv')) {
                        tableName = item.getName().replace('.csv', '');
                        if (!tableName.includes('#')) {
                            jsTable = databaseManager.getTable(mediaItem.dbName, tableName);
                            if (!jsTable) {
                                application.output("Skipping table: " + mediaItem.dbName + "." + tableName + " - table not found", LOGGINGLEVEL.DEBUG);
                                return;
                            }
                            if (deleteExistingData) {
                                if (isMicrosoftDB(mediaItem.dbName) || isProgressDB(mediaItem.dbName)) {
                                    executeQuery(mediaItem.dbName, jsTable, ['delete from ' + jsTable.getQuotedSQLName() + ';']);
                                } else {
                                    executeQuery(mediaItem.dbName, jsTable, ['TRUNCATE TABLE ' + jsTable.getQuotedSQLName() + ' CASCADE;']);
                                }
                            }
                        }
                    }
                })
            }
            if (executeInTransaction) {
                databaseManager.startTransaction();
            }
            for (var zipContentIndex in zipContent) {
                /**@type {plugins.file.JSFile} folderItem */
                var folderItem = zipContent[zipContentIndex];
                if (folderItem.isFile() && folderItem.getName().match('.csv')) {
                    tableName = folderItem.getName().replace('.csv', '').split('#')[0];
                    importCsvFile(mediaItem.dbName, tableName, folderItem, statusCallBackFunction);

                    //Force clear JSFile Ref & sleep to give GC time
                    folderItem = null;
                    application.sleep(200);

                    if (!seededTables[mediaItem.dbName]) {
                        seededTables[mediaItem.dbName] = new Array();
                    }
                    seededTables[mediaItem.dbName].push(tableName);
                }
            }

            if (executeInTransaction) {
                databaseManager.commitTransaction(true, false);
            }

            //Flush all tables after commit of data
            seededTables[mediaItem.dbName].forEach( /**@param {String} table */ function (table) {
                plugins.rawSQL.flushAllClientsCache(mediaItem.dbName, table)
            })

        }

        plugins.file.deleteFolder(mediaItem.unzipDirectory, false);
    });

    if (clearTablesNotInSeed) {
        Object.keys(seededTables).forEach( /** @param {String} dbName */ function (dbName) {
            var tables = databaseManager.getTableNames(dbName);
            for (var tableIndex in tables) {
                var table = tables[tableIndex];
                if (seededTables[dbName].indexOf(table) == -1) {
                    jsTable = databaseManager.getTable(dbName, table);
                    if (jsTable.isMetadataTable()) {
                        application.output("Skipping clearing metadata table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
                    } else if (Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getSolution().getI18nDataSource() == jsTable.getDataSource()) {
                        application.output("Skipping clearing i18n table: " + jsTable.getDataSource(), LOGGINGLEVEL.DEBUG);
                    } else {
                        if (isMicrosoftDB(dbName)) {
                            executeQuery(dbName, jsTable, ['delete from ' + jsTable.getQuotedSQLName() + ';']);
                        } else {
                            executeQuery(dbName, jsTable, ['TRUNCATE TABLE ' + jsTable.getQuotedSQLName() + ' CASCADE;']);
                        }
                    }
                }
            }
        });
    }
}

/**
 * @private
 * @param {String} dbName
 * @param {String} tableName
 * @param {plugins.file.JSFile} file
 * @param {Function} [statusCallBackFunction]
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"51493998-12F6-4CA9-A869-7DC65DAAB682"}
 */
function importCsvFile(dbName, tableName, file, statusCallBackFunction) {
    /**@type {Array<String>} */
    var header = [];
    /**@type {Array<String>} */
    var fullHeader = [];
    var counter = 0;
    /**@type {Array<String>} */
    var queryToExec = [];
    var lineCount = scopes.svyIO.getLineCountForFile(file) - 1;
    //Small sleep to give GC some time
    application.sleep(100);
    var columnDiffs = [];
    var hasMediaColumn = false;
    var table = databaseManager.getTable(dbName, tableName);

    /**@param {{columnNames: Array, data: Array, [errors]: Array, [meta]: {delimiter: String, linebreak: String, aborted: Boolean, truncated: Boolean, cursor: Number}}} csvData */
    function importData(csvData) {
        //Reset the flag to make it more dynamic
        hasMediaColumn = false;
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
                header = header.filter(function (item) {
                    return (columnDiffs.indexOf(item) === -1)
                }).map(function (col) {
                    // Quote column name only if needed, Progress supports special chars ($, %, #, -) that need to be quoted
                    return /[\$\-%#]/.test(col) ? '"' + col + '"' : col
                })

            }

            for (var csvDataIndex in csvData.data) {
                /**@type {Array} */
                var rowData = csvData.data[csvDataIndex];
                if (rowData) {
                    counter++;
                    if (rowData != undefined) {

                        //If we have columnDiffs found we should clear the csv import row
                        if (columnDiffs.length) {
                            rowData = rowData.filter(function (item, index) {
                                for (var i in columnDiffs) {
                                    if (fullHeader.indexOf(columnDiffs[i]) == index) {
                                        return false;
                                    }
                                }
                                return true;
                            })
                        }
                        if (rowData.length > header.length) {
                            application.output('Datarow contains more data columns then it should have, skipping this row `' + rowData + '`, this will break the data.. data should be fixed', LOGGINGLEVEL.ERROR);
                            continue;
                        }

                        /** @type {Array<*>} */
                        var values = rowData.map(
                            /**
                             * @param {*} value
                             * @param {Number} index
                             * @return {String|Number}
                             */
                            function (value, index) {
                                /**@type {String} */
                                var columnName = header[index] || JSON.parse(header[index] || '')
                                var column = table.getColumn(columnName);
                                //Convert types
                                if (column) {
                                    switch (column.getType()) {
                                        case JSColumn.DATETIME:
                                            if (value) {
                                            	if (/^\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d/.test(value)) {
                                                	return "'" + value + "'";
                                                } else if (/^\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)) {
                                                    var newDate = utils.dateFormat(utils.parseDate(value.replace('T', ' '), 'yyyy-MM-dd HH:mm:ssZ', 'UTC'), 'yyyy-MM-dd HH:mm:ss');
                                                    if (newDate) {
                                                        return "'" + newDate + "'";
                                                    }
                                                }
                                            }
                                            return 'NULL';
                                        case JSColumn.INTEGER:
                                            var returnInt = ['', 'Infinity', 'NaN'].includes(value.toString()) ? 'NULL' : parseInt(value.toString());
                                            if (isNaN(returnInt)) {
                                                returnInt = 'NULL';
                                            } else if (returnInt != 'NULL') {
                                                // FIX for boolean in postgres
                                                returnInt = "'" + returnInt + "'";
                                            }
                                            return returnInt;
                                        case JSColumn.NUMBER:
                                            var returnNum = ['', 'Infinity', 'NaN'].includes(value.toString()) ? 'NULL' : parseFloat(value.toString());
                                            if (isNaN(returnNum)) {
                                                returnNum = 'NULL';
                                            }
                                            return returnNum;
                                        case JSColumn.MEDIA:
                                            if (value) {
                                                hasMediaColumn = true; //Will force the sql execute to max 25 instead to max it too 100MB
                                                if (value.startsWith('base64:')) {
                                                    //Media is double encoded to have a easy workaround for linebreaks
                                                    return "decode('" + utils.base64ToString(value.replace('base64:', '')) + "', 'base64')";
                                                } else {
                                                    return "decode('" + value + "', 'base64')";
                                                }
                                            } else {
                                                return 'NULL';
                                            }
                                            default:
                                                if (!value && column.getAllowNull() || value == 'base64:' && column.getAllowNull()) {
                                                    return 'NULL';
                                                } else {
                                                    if (value && value.startsWith('base64:')) {
                                                        value = utils.base64ToString(value.replace('base64:', ''));
                                                    }
                                                    if (value && value.length > column.getLength()) {
                                                        value = value.substr(0, column.getLength())
                                                    }
                                                    return "'" + utils.stringReplace(value || "", "'", "''") + "'";
                                                }
                                    }
                                } else {
                                    application.output("FAILED TO GET COLUMN: " + header[index] + " IN TABLE: " + tableName, LOGGINGLEVEL.ERROR);
                                    return 'NULL';
                                }
                            });
                        if (isPostgresDB(dbName) || isMicrosoftDB(dbName)) {
                            //Postgres & MSSQL support multi insert.
                            if (queryToExec.length == 0) {
                                queryToExec.push('INSERT INTO ' + table.getQuotedSQLName() + ' (' + header.join(', ') + ') VALUES \n')
                            }
                            queryToExec.push('(' + values.join(', ') + '),');
                        } else {
                            queryToExec.push('INSERT INTO ' + table.getQuotedSQLName() + ' (' + header.join(', ') + ') VALUES (' + values.join(', ') + ');')
                        }
                        csvData.data[csvDataIndex] = null;
                        rowData = null;
                        //Run insert on every 5000 lines or when it has a media column with force every 100 rows
                        if ((hasMediaColumn && queryToExec.length >= 100) || queryToExec.length >= 5000) {
                            if (isPostgresDB(dbName) || isMicrosoftDB(dbName)) {
                                queryToExec[queryToExec.length - 1] = queryToExec[queryToExec.length - 1].replace(/,$/, ';')
                            }
                            if (!executeQuery(dbName, table, queryToExec)) {
                                application.output('FAILED TO INSERT insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.ERROR);
                            }

                            queryToExec = [];
                            application.output('Executed insert sql ' + counter + ' of ' + lineCount + ' in table: `' + tableName + '` has mediacolumn: ' + hasMediaColumn, LOGGINGLEVEL.DEBUG);
                            if(statusCallBackFunction) {
                            	statusCallBackFunction('running', tableName, counter, lineCount);
                            }
                        }
                    }
                }
            }
        } else {
            application.output('Import of file: ' + dbName + ' / ' + tableName + ' -skipped / table not found on server!!-', LOGGINGLEVEL.INFO);
        }
        return true;
    }

    application.output('Import of file (' + file.getName() + '): ' + dbName + ' / ' + tableName + ' -Started-', LOGGINGLEVEL.INFO);
    if(statusCallBackFunction) {
    	statusCallBackFunction('started', tableName, null, lineCount);
    }

    var isNewExport = false;
    var prevSeperatorCount = 0;
    //Validate CSV File if it is a new type
    scopes.svyIO.readFile(file, /**@param {String} lineData */ function (lineData) {
        if (lineData) {
            var splitCount = lineData.split(',');
            if (prevSeperatorCount != 0 && splitCount.length != prevSeperatorCount) {
                isNewExport = false;
                return false;
            } else {
                prevSeperatorCount = splitCount.length;
                isNewExport = true
            }
        }
        return true;
    }, 'UTF-8');

    if (!isNewExport) {
        var fileData = plugins.file.readTXTFile(file, 'UTF-8');
        application.output("Will import the data the old way, please generate a new dataseed to enjoy faster import");
        lineCount = ((fileData.match(/^"[^,\n\r]/gm) || []).length - 1);
        scopes.svyDataUtils.parseCSV(fileData, {
            delimiter: ',',
            firstRowHasColumnNames: true,
            textQualifier: '"'
        }, importData);

        //Force call parseCSV with dummy csv to workaround Rhino function arguments being kept inmem
        scopes.svyDataUtils.parseCSV('"dummy"', {
            delimiter: ',',
            firstRowHasColumnNames: true,
            textQualifier: '"'
        });
    } else {
        var csvObj = {
            columnNames: [],
            data: []
        };
        scopes.svyIO.readFile(file, /**@param {String} fileLine */ function (fileLine) {
            if (fileLine) {
                if (csvObj.columnNames.length == 0) {
                    csvObj.columnNames = fileLine.substring(1, fileLine.length - 1).split('","');
                } else {
                    csvObj.data = [fileLine.substring(1, fileLine.length - 1).split('","')];
                    return importData(csvObj);
                }
            }
            return true;
        }, 'UTF-8');
    }

    if (queryToExec.length != 0) {
        if (isPostgresDB(dbName) || isMicrosoftDB(dbName)) {
            queryToExec[queryToExec.length - 1] = queryToExec[queryToExec.length - 1].replace(/,$/, ';')
        }
        if (!executeQuery(dbName, table, queryToExec)) {
            application.output('FAILED TO INSERT insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.ERROR);
        }

        queryToExec = [];

        //We do a final wait count te be sure that we do not have any async queries running
        var waitCount = 0;
        while (hasAsyncCall == true && waitCount < 200) {
            application.sleep(50);
            waitCount++;
        }
        application.output('Executed insert sql ' + counter + ' of ' + lineCount, LOGGINGLEVEL.DEBUG);
    }
    application.output('Import of file: ' + dbName + ' / ' + tableName + ' -done-', LOGGINGLEVEL.INFO);
    if(statusCallBackFunction) {
    	statusCallBackFunction('done', tableName);
    }

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
    if (isMicrosoftDB(dbName)) {
        // enable/disable identity insert
        if (hasDatabaseIdentity(table)) {
            preInsertSQL += 'SET IDENTITY_INSERT ' + table.getQuotedSQLName() + ' ON;';
            postInsertSQL += 'SET IDENTITY_INSERT ' + table.getQuotedSQLName() + ' OFF;'
        }
    } else if (isPostgresDB(dbName)) {
    	preInsertSQL += "SET WORK_MEM='" + (getCurrentWorkMem(dbName).value * 2) + getCurrentWorkMem(dbName).size +"';\n"
        preInsertSQL += 'SET session_replication_role = replica;\n BEGIN;\n';
        postInsertSQL += '\nCOMMIT;\nSET session_replication_role = DEFAULT;';
        postInsertSQL += '\nRESET WORK_MEM;'
        if (table.getRowIdentifierColumnNames().length > 0 && table.getColumn(table.getRowIdentifierColumnNames()[0]).getSequenceType() == JSColumn.DATABASE_SEQUENCE && table.getColumn(table.getRowIdentifierColumnNames()[0]).getType() == JSColumn.INTEGER) {
            var sequenceName;
            var dsSeq = databaseManager.getDataSetByQuery(table.getServerName(), "SELECT pg_get_serial_sequence('" + table.getSQLName() + "', '" + table.getColumn(table.getRowIdentifierColumnNames()[0]).getQuotedSQLName() + "')", null, 1)
            if (dsSeq.getMaxRowIndex() == 1 && dsSeq.getValue(1, 1)) {
                sequenceName = dsSeq.getValue(1, 1);
            } else {
                //Get sequence with workaround
                sequenceName = Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getFoundSetManager().getTable(table.getDataSource()).getColumn(table.getRowIdentifierColumnNames()[0]).getColumnInfo().getDatabaseSequenceName();
            }

            if (sequenceName) {
                postInsertSQL += "SELECT setval('" + sequenceName + "', COALESCE(CAST(max(" + table.getColumn(table.getRowIdentifierColumnNames()[0]).getQuotedSQLName() + ") AS INT), 1)) FROM " + table.getQuotedSQLName() + ";";
            } else {
                application.output("Table " + table.getSQLName() + " is using DB Sequence, but postgres isn't returning a sequence.", LOGGINGLEVEL.WARNING);
            }
        }

        if (table.getRowIdentifierColumnNames().length > 0 && table.getColumn(table.getRowIdentifierColumnNames()[0]).getSequenceType() == JSColumn.SERVOY_SEQUENCE) {
            application.output("Table " + table.getSQLName() + " is using Servoy Sequence, this should be avoided. For now a manual update of the sequence is required", LOGGINGLEVEL.WARNING);
        }
    }

    var waitCount = 0;
    while (hasAsyncCall == true && waitCount < 100) {
        application.sleep(50);
        waitCount++;
    }
    
    hasAsyncCall = true;
    Packages.com.servoy.j2db.J2DBGlobals.getServiceProvider().getScheduledExecutor().execute(new java.lang.Runnable({
        run: function () {
            try {
                queryToExec.unshift(preInsertSQL);
                queryToExec.push(postInsertSQL);
                if (!plugins.rawSQL.executeSQL(dbName, '/*IGNORE-SQL-TIMING-LOGGING*/\n' + queryToExec.join('\n'))) {
                    application.output('Failed to run the following query: `' + queryToExec + '`, reason: ' + plugins.rawSQL.getException().getMessage(), LOGGINGLEVEL.ERROR);
                }
            } finally {
                hasAsyncCall = false;
            }
            return true;
        }
    }));
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
    if (DB_CACHE.mssql.hasOwnProperty(dbName)) {
        return DB_CACHE.mssql[dbName];
    } else {
        DB_CACHE.mssql[dbName] = databaseManager.getDatabaseProductName(dbName).match('microsoft') ? true : false;
        return DB_CACHE.mssql[dbName];
    }
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
    if (DB_CACHE.postgres.hasOwnProperty(dbName)) {
        return DB_CACHE.postgres[dbName];
    } else {
        DB_CACHE.postgres[dbName] = databaseManager.getDatabaseProductName(dbName).match('postgres') ? true : false;
        return DB_CACHE.postgres[dbName];
    }
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
    if (DB_CACHE.openedge.hasOwnProperty(dbName)) {
        return DB_CACHE.openedge[dbName];
    } else {
        DB_CACHE.openedge[dbName] = databaseManager.getDatabaseProductName(dbName).match('openedge') ? true : false;
        return DB_CACHE.openedge[dbName];
    }
}