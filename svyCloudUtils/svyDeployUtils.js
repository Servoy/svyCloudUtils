/**
 * Method to copy all jasperreports that are located in the reports folder to the jasperreport location on the server.
 * @public
 * @properties={typeid:24,uuid:"8E60915A-6880-4A8E-8B3D-0F03B4752CB0"}
 */
function copyReportsToServer() {
	var location = plugins.file.getDefaultUploadLocation().replace('uploads', '')
	var mediaFiles = solutionModel.getMediaList();
	application.output('Copying reports', LOGGINGLEVEL.DEBUG);
	for(var mediaIndex in mediaFiles) {
		var media = mediaFiles[mediaIndex];
		if (media.getName().match(/reports/) && (media.getName().match(/jrxml/) || media.getName().match(/jasper/))) {
			plugins.file.deleteFile(location + java.io.File.separator + media.getName());
			var file = plugins.file.createFile(location + java.io.File.separator + media.getName());
			plugins.file.createFolder(file.getPath().replace(file.getName(), ''));
			plugins.file.writeFile(file, media.bytes);
			application.output('Writing report file: ' + file.getAbsolutePath(), LOGGINGLEVEL.DEBUG);
		}
	}
}

/**
 * @param database
 *
 * @properties={typeid:24,uuid:"4C8C9541-CD2E-41A9-9775-62C53EE48ABF"}
 */
function removeAllTablesFromDatabase(database) {
	var tables = databaseManager.createEmptyDataSet(0, ['tablename']);
	if (isPostgresDB(database)) {
		tables = databaseManager.getDataSetByQuery(database, "select tablename from pg_tables where schemaname = 'public'", [], -1);
	}

	for (var i = 0; i < tables.getMaxRowIndex(); i++) {
		if(!plugins.rawSQL.executeSQL(database, 'drop table if exists ' + tables[i].tablename + ' cascade;')) {
			application.output(plugins.rawSQL.getException(), LOGGINGLEVEL.ERROR)
		};
	}

	if (!application.isInDeveloper()) {
		plugins.maintenance.getServer(database).reloadDataModel();
	} else {
		plugins.dialogs.showWarningDialog('Refresh','Please refresh all databases and do a resync');
	}
}

/**
 * @private
 *
 * @param {String} dbName
 * @return {Boolean}
 *
 * @properties={typeid:24,uuid:"34F1BA34-478B-4764-83EE-AB59DBC82D6E"}
 */
function isPostgresDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('postgres') ? true : false;
}

/**
 * @enum
 * @properties={typeid:35,uuid:"484959BC-5196-4005-BE4B-4C6224A0393F",variableType:-4}
 */
var DB_IMPORT_TYPE = {
	REPEAT: 'R',
	VERSION: 'V'
}
/**
 * Method to run DB Migration on postImport with version store.
 * All SQL Files should be located in the folder `database-migration` and should be named as follow:
 *
 * Files Starting with V are version files.. files with R are repeat files and will always execute.
 * Example Version naming V__1__dbName__myDescription
 * Example Repeat naming R__1__dbName__myDescription
 *
 * There should be double _ between all name parts to correctly parse then, when not there the file will be ignored.
 *
 * Files will be sorted on versionnumber and execute once when it are version files.
 *
 * @public
 *
 * @param {String} [versionTableName] tableName to store the version data, when this is set it will not be stored in the servoy.properties file
 * @param {String} [migrationFilesFolder] optional custom media folder path instead of the default "database-migration."
 *
 * @properties={typeid:24,uuid:"89B79D43-CD47-4476-8ECE-0651A28AD263"}
 */
function runDBVersionUpgrade(versionTableName, migrationFilesFolder) {
	migrationFilesFolder = migrationFilesFolder||'database-migration';
	
	var medias = solutionModel.getMediaList();
	/**@type {Array<parseMediaDBFile>} */
	var foundVersions = [];
	/**@type {Array<parseMediaDBFile>} */
	var foundRepeats = [];
	/**@type {Array<String>} */
	var allVersionsDBNames = [];

	//Filter all the types and select matched on naming
	for (var mediaIndex in medias) {
		var media = medias[mediaIndex];
		var parsedFile = new parseMediaDBFile(media, migrationFilesFolder);
		if (parsedFile.isValidFile()) {
			if (parsedFile.type == DB_IMPORT_TYPE.VERSION) {
				foundVersions.push(parsedFile);
			} else {
				foundRepeats.push(parsedFile);
			}
			if(allVersionsDBNames.indexOf(parsedFile.dbServer) == -1) {
				allVersionsDBNames.push(parsedFile.dbServer);
			}
		}
	}

	//Sort everything on versionnumber
	foundVersions.sort(sortVersion);
	foundRepeats.sort(sortVersion);
	
	// Check for duplicates in foundVersions
	for (var j = 0; j < foundVersions.length - 1; j++) {
	    var current = foundVersions[j];
	    var next = foundVersions[j + 1];

	    if (current.dbServer === next.dbServer && current.version === next.version) {
	        throw new Error('Duplicate version ' + current.version + ' found for database ' + current.dbServer);
	    }
	}

	// Check for duplicates in foundRepeats
	for (var k = 0; k < foundRepeats.length - 1; k++) {
	    var currentRepeat = foundRepeats[k];
	    var nextRepeat = foundRepeats[k + 1];

	    if (currentRepeat.dbServer === nextRepeat.dbServer && currentRepeat.version === nextRepeat.version) {
	        throw new Error('Duplicate repeat version ' + currentRepeat.version + ' found for database ' + currentRepeat.dbServer);
	    }
	}

	for(var dbNameIndex in allVersionsDBNames) {
		var currentDBVersionName = allVersionsDBNames[dbNameIndex];
		//Create 2 new arrays with only the sql files needed for this database
		var foundVersionsForDBName = foundVersions.filter(/**@param {parseMediaDBFile} item */function(item) {
			return item.dbServer == currentDBVersionName;
		})
		
		var foundRepeatsForDBName = foundRepeats.filter(/**@param {parseMediaDBFile} item */function(item) {
			return item.dbServer == currentDBVersionName;
		})
		
		// Get the list of all databases (main + clones) for this DB name
		var allDatabasesForDBName = getAllDBs(currentDBVersionName);
		
		// Merge and sort version and repeat files by version number
		var allMigrationFiles = foundVersionsForDBName.concat(foundRepeatsForDBName);
		allMigrationFiles.sort(sortVersion);
		
		// Process each database individually
		for(var dbIndex = 0; dbIndex < allDatabasesForDBName.length; dbIndex++) {
			var dbServerName = allDatabasesForDBName[dbIndex];
			createVersionTable(dbServerName, versionTableName);
			var currentVersion = getCurrentVersion(dbServerName, versionTableName);	
			var nextVersionToApply = currentVersion;
			
			// Track which repeats have been executed for this database
			var executedRepeats = {};
			
			// Keep processing until all versions and repeats have been handled
			var allProcessed = false;
			while (!allProcessed) {
				allProcessed = true;
				
				for(var mIndex = 0; mIndex < allMigrationFiles.length; mIndex++) {
					var migrationFile = allMigrationFiles[mIndex];
					
					// For version files, apply if it's the next version to apply
					if (migrationFile.type === DB_IMPORT_TYPE.VERSION) {
						if (migrationFile.version === (nextVersionToApply + 1)) {
							if (!plugins.rawSQL.executeSQL(dbServerName, '/*IGNORE-SQL-TIMING-LOGGING*/\n' + migrationFile.getFileData())) {
								throw new Error('Failed to run version migration SQL FILE: ' + migrationFile.name + ' \n' + plugins.rawSQL.getException());
							} else {
								getTableNamesDataChangesAndTriggerFlush(migrationFile.getFileData(), dbServerName)
							}
							setCurrentVersion(migrationFile.version, dbServerName, versionTableName);
							nextVersionToApply = migrationFile.version;
							
							application.output(`Successfully applied migration File: ${migrationFile.name} for database: ${dbServerName} to version: ${nextVersionToApply}`, LOGGINGLEVEL.WARNING);
							allProcessed = false;
							break; // Restart loop to process in correct order
						}
					}
					// For repeat files, run if their version is at or below current and not yet executed
					else if (migrationFile.type === DB_IMPORT_TYPE.REPEAT) {
						if (migrationFile.version <= nextVersionToApply && !executedRepeats[migrationFile.name]) {
							if (!plugins.rawSQL.executeSQL(dbServerName, '/*IGNORE-SQL-TIMING-LOGGING*/\n' + migrationFile.getFileData())) {
								throw new Error('Failed to run repeat migration SQL FILE: ' + migrationFile.name + ' \n' + plugins.rawSQL.getException());
							} else {
								getTableNamesDataChangesAndTriggerFlush(migrationFile.getFileData(), dbServerName)
							}
							executedRepeats[migrationFile.name] = true;
							application.output(`Successfully applied repeat migration File: ${migrationFile.name} for database: ${dbServerName}`, LOGGINGLEVEL.WARNING);
							allProcessed = false;
							break; // Restart loop
						}
					}
				}
			}
		}
	}

	//Reload datamodel for all servers
	if (!application.isInDeveloper()) {
		var allServers = plugins.maintenance.getServerNames(true);
		for (var i in allServers) {
			if(!databaseManager.getDatabaseProductName(allServers[i]).startsWith('hsql')) {
				plugins.maintenance.getServer(allServers[i]).reloadDataModel();
			}
		}
	} else {
		application.output('Please Reload all tables/table structure from DB!!');
	}
}

/**
 * @protected 
 * @param {String} fileContent
 * @param {String} serverName
 *
 * @properties={typeid:24,uuid:"B7A33B66-D4A4-445A-8B16-F31A61F4526A"}
 */
function getTableNamesDataChangesAndTriggerFlush(fileContent, serverName) {
	   var tableNames = {};
	   var regex = /\b(UPDATE|INSERT INTO|DELETE FROM)\s+([\w_]+)/gi;
	   /**@type {Array<String>} */
	   var match;
	   while ((match = regex.exec(fileContent.replace(/\s\s+/g, ' '))) !== null) {
	        var tableName = match[2].trim();

	        
	        // add table name to set
	        tableNames[tableName] = true;
	   }
	   Object.keys(tableNames).forEach(function(tableToFlush) {
		   if(databaseManager.getTable(serverName,tableToFlush)) {
			   plugins.rawSQL.flushAllClientsCache(serverName,tableToFlush);
		   }
	   })
	}

/**
 * @private
 * @param {String} mainDB
 * @return {Array<String>}
 *
 * @properties={typeid:24,uuid:"C7C2BA2D-7268-4B2C-B3AD-396D13C364B4"}
 */
function getAllDBs(mainDB) {
	return [mainDB].concat(databaseManager.getDataModelClonesFrom(mainDB));
}

/**
 * @private
 * @param {String} serverName
 * @param {String} [tableName]
 *
 * @properties={typeid:24,uuid:"02B78AC6-8A44-4534-A67A-1F162FADC988"}
 */
function createVersionTable(serverName, tableName) {
	if (serverName && tableName) {
		if (!databaseManager.getTable(serverName, tableName)) {
			if (application.isInDeveloper()) {
				throw new Error("Creation of db_version table isn't supported from developer, please create table manual: " + tableName + " with columns: (`id`, type: text, length: 36, allowNull: false, PK, sequenceType: UUID Generator) && (`versionnumber`, type: int, allowNull: false)");
			}
			var versionTable = plugins.maintenance.getServer(serverName).createNewTable(tableName);
			var pkColumn = versionTable.createNewColumn('id', JSColumn.TEXT, 36, false, true);
			pkColumn.setFlag(JSColumn.UUID_COLUMN, true);
			pkColumn.sequenceType = JSColumn.UUID_GENERATOR;
			versionTable.createNewColumn('versionnumber', JSColumn.INTEGER, 0, false);

			plugins.maintenance.getServer(serverName).synchronizeWithDB(versionTable);
		}
	}
}

/**
 * @public 
 * @param {String} [serverName]
 * @param {String} [tableName]
 *
 * @return {Number}
 * @properties={typeid:24,uuid:"B14FE757-40B3-44E8-A647-8817212E8F3E"}
 */
function getCurrentVersion(serverName, tableName) {
	var currentVersion = 0;
	if (serverName && tableName) {
		if(datasources.db[serverName][tableName]) {
			/**@type {QBSelect} */
			var sql = datasources.db[serverName][tableName].createSelect();
			sql.result.add(sql.columns['versionnumber']);
	
			//Get all data, sorting on int can be different based on DB settings
			var ds = databaseManager.getDataSetByQuery(sql, -1);
			for (var i = 1; i <= ds.getMaxRowIndex(); i++) {
				if (currentVersion <= parseInt(ds.getValue(i, 1))) {
					currentVersion = ds.getValue(i, 1);
				}
			}
		} else {
			application.output("Couldn't find the existing version table. DB Version will be 0.")
			return 0;
		}
	} else {
		currentVersion = parseInt(getServoyProperty(serverName.toUpperCase() + '.DB_VERSION') || getServoyProperty('DB_VERSION') || '0');
	}
	return currentVersion
}

/**
 * @private
 * @param {Number} versionNumber
 * @param {String} [serverName]
 * @param {String} [tableName]
 *
 * @properties={typeid:24,uuid:"FBEAD04E-8250-4710-BEFD-7FC3EBF35764"}
 */
function setCurrentVersion(versionNumber, serverName, tableName) {
	if (serverName && tableName) {
		/**@type {JSFoundSet} */
		var fs = databaseManager.getFoundSet(serverName,tableName);
		if (fs) {
			var rec = fs.getRecord(fs.newRecord());
			if(!rec['id']) {
				rec['id'] = application.getUUID()
			}
			rec['versionnumber'] = versionNumber;
			if(!databaseManager.saveData(rec)) {
				throw Error("Can't save record to SQL Version table: " + serverName +"." + tableName + " error: " + rec.exception.getMessage())
			}
			fs.clear();
		} else {
			throw Error("Can't write version to SQL Version table: " + serverName +"." + tableName)
		}
	}
	setServoyProperty(serverName.toUpperCase() + '.DB_VERSION', versionNumber.toString());
}

/**
 * @protected
 * @constructor
 * @param {JSMedia} media
 * @param {String} migrationFilesFolder
 * @properties={typeid:24,uuid:"0899102D-D692-4191-A6B7-C6F74F73B44F"}
 */
function parseMediaDBFile(media, migrationFilesFolder) {

	/**
	 * @type {JSMedia}
	 * @protected
	 */
	this.mediaFile = media;

	/**
	 * @type {String}
	 * @public
	 */
	this.name = this.mediaFile.getName();

	/**
	 * @type {Boolean}
	 * @public
	 */
	this.isValidFile = function() {
		if (this.name.startsWith(migrationFilesFolder) && this.name.endsWith('.sql')) {
			if (this.name.match(new RegExp(migrationFilesFolder + "/(V|R)__"))) {
				if (this.name.match(new RegExp(migrationFilesFolder + "/(V|R)__(\\d*)__"))) {
					var dbName = this.name.replace(new RegExp(migrationFilesFolder + "/(V|R)__(\\d*)__"), '').split('__')[0];
					if (datasources.db[dbName]) {
						return true;
					} else {
						application.output('File contains an non existing Servoy DB Name V__xx__????: ' + this.name, LOGGINGLEVEL.ERROR);
					}
				} else {
					application.output('File is missing versionnumber V__??: ' + this.name, LOGGINGLEVEL.ERROR);
				}
			} else {
				application.output('File is missing type (V = Version | R = Repeat): ' + this.name, LOGGINGLEVEL.ERROR);
			}
		}

		return false;
	};

	/**
	 * @type {Number}
	 * @public
	 */
	 this.version = this.isValidFile() ? parseInt(this.name.match(new RegExp(migrationFilesFolder + "/(V|R)__(\\d*)__"))[0].replace(/\D/g, '')) : null;

	/**
	 * @type {String}
	 * @public
	 */
	this.type = this.isValidFile() ? (this.name.match(new RegExp(migrationFilesFolder + "/V__")) ? DB_IMPORT_TYPE.VERSION : DB_IMPORT_TYPE.REPEAT) : null;

	/**
	 * @type {String}
	 * @public
	 */
	this.dbServer = this.isValidFile() ? this.name.replace(new RegExp(migrationFilesFolder + "/(V|R)__(\\d*)__"), '').split('__')[0] : null;
	;

	/**
	 * @return {String}
	 * @public
	 */
	this.getFileData = function() {
		return this.mediaFile.getAsString();
	}

	Object.seal(this);
	return this;
}

/**
 * @private
 * @param {parseMediaDBFile} a
 * @param {parseMediaDBFile} b
 *
 * @return {Number}
 *
 * @properties={typeid:24,uuid:"40E66BB8-C6B6-4671-8FCF-1D6CC94DA8C9"}
 */
function sortVersion(a, b) {
	var correctA = a.version;
	var correctB = b.version;
	return correctA - correctB;
}

/**
 * @public
 * @param {String} name
 *
 * @return {String}
 *
 * @properties={typeid:24,uuid:"279627B0-9B3E-47A4-B00F-E5BD32E6A3C5"}
 */
function getServoyProperty(name) {
	var versionStr = application.getVersion().trim();
	var servoyVersion = utils.stringToNumber(versionStr.trim().split('.').map(function(value) {return (value.length < 2 ? ("0" + value) : value)}).join(''));

	var returnValue;
	if (servoyVersion < 2025060) {
		returnValue = Packages.com.servoy.j2db.util.Settings.getInstance().get(name);
	} else {
		returnValue = application.getServoyProperty(name);
	}

	return returnValue ? String(returnValue) : null;
}

/**
 * @public
 * @param {String} name
 *
 * @return {String}
 *
 * @properties={typeid:24,uuid:"B1B64E55-4E90-4F8B-BABE-9EE5F980C374"}
 */
function getSystemProperty(name) {
	var value = Packages.java.lang.System.getProperty(name);
	if (!value) {
		return null;
	}
	return value.toString();
}

/**
 * @public
 * @param {String} name
 *
 * @return {String}
 *
 * @properties={typeid:24,uuid:"BB8A9DDD-78FE-4A8C-A807-428BFA3940D0"}
 */
function getEnvironmentProperty(name) {
	var value = Packages.java.lang.System.getenv(name);
	if (!value) {
		return null;
	}
	return value.toString();
}

/**
 * @public
 * @param {String} name
 * @param {String} newValue
 *
 * @properties={typeid:24,uuid:"2AFDEE70-ECC3-4483-A275-86D4989CEFEA"}
 */
function setServoyProperty(name, newValue) {
	var versionStr = application.getVersion().trim();
	var servoyVersion = utils.stringToNumber(versionStr.trim().split('.').map(function(value) {return (value.length < 2 ? ("0" + value) : value)}).join(''));
	var instance = Packages.com.servoy.j2db.util.Settings.getInstance();
	if(servoyVersion < 2025060) {
		instance.put(name, newValue);
	} else {
		instance.setProperty(name, newValue);
	}
	
	instance.save();
}

/**
 * @public 
 * @param {String} randomServoyServerName
 * 
 * @properties={typeid:24,uuid:"FC3E751E-5588-4274-8ADA-9CFB532ED1D1"}
 */
function initCloneServersBasedOnDatabaseInfo(randomServoyServerName) {
	if(!isPostgresDB(randomServoyServerName)) {
		application.output('initCloneServersBasedOnDatabaseInfo is currently only supported for Postgres databases', LOGGINGLEVEL.ERROR);
		return;
	}
	var sql = "SELECT d.datname AS database_name, pg_catalog.shobj_description(d.oid, 'pg_database') AS comment FROM pg_catalog.pg_database d ORDER BY d.datname;";
	var ds = databaseManager.getDataSetByQuery(randomServoyServerName, sql, [], -1);
	
	for(var i = 1; i <= ds.getMaxRowIndex(); i++) {
		/**@type {String} */
		var postgresServerName = ds.getValue(i,1);
		/**@type {String} */
		var comment = ds.getValue(i,2);
		if(comment && comment.trim().startsWith('{') && comment.trim().endsWith('}')) {
			/**@type {{cloneFromSVYName: String, SVYName: String}} */
			var parsedData = JSON.parse(comment);
			if(parsedData.cloneFromSVYName && parsedData.SVYName && !databaseManager.getServerNames().includes(parsedData.SVYName)) {
				createNewCloneOfDatabase(parsedData.cloneFromSVYName, postgresServerName, parsedData.SVYName);
			}
		}
	}
}

/**
 * @public 
 * @param {String} originalDBServoyName
 * @param {String} newDBNamePostgres
 * @param {String} [newDBNameServoyName] when empty 'newDBNamePostgres' will be used
 * @return {Boolean}
 * 
 * @properties={typeid:24,uuid:"068BA581-0335-4C93-96C2-A1BAAC12A29F"}
 */
function createNewCloneOfDatabase(originalDBServoyName,newDBNamePostgres, newDBNameServoyName ) {
	var allDBNames = datasources.db['allnames'] || [];
	if(!allDBNames.includes(originalDBServoyName)) {
		application.output('Given originalDB: ' + originalDBServoyName + " doesn't exist within this servoy configuration");
		return false;
	}
	
	if(allDBNames.includes((newDBNameServoyName||newDBNamePostgres))) {
		application.output('Ignore generating properties config for database: ' + (newDBNameServoyName||newDBNamePostgres) + ' already exists', LOGGINGLEVEL.DEBUG);
		return false;
	}
	
	var currentServerConfig = Packages.com.servoy.j2db.server.shared.ApplicationServerRegistry.get().getServerManager().getServerConfig(originalDBServoyName);
	var Builder = new Packages.com.servoy.j2db.persistence.ServerConfig.Builder(currentServerConfig);
	Builder.setServerUrl(currentServerConfig.getServerUrl().replace('/' + getServerNameFromJdbcUrl(currentServerConfig.getServerUrl()) ,'/' + newDBNamePostgres))
	Builder.setDataModelCloneFrom(originalDBServoyName)
	Builder.setServerName((newDBNameServoyName||newDBNamePostgres))
	var newDbServer = Builder.build()
	
	Packages.com.servoy.j2db.server.shared.ApplicationServerRegistry.get().getServerManager().createServer(newDbServer);
	Packages.com.servoy.j2db.server.shared.ApplicationServerRegistry.get().getServerManager().saveServerConfig(null,newDbServer);
	
	var sql = 'COMMENT ON DATABASE "' + newDBNamePostgres + '" IS \'{"cloneFromSVYName": "' + originalDBServoyName + '", "SVYName": "' + (newDBNameServoyName||newDBNamePostgres) + '"}\';'
	plugins.rawSQL.executeSQL(originalDBServoyName,sql);
	
	return true;
}

/**
 * @private 
 * @param {String} jdbcUrl
 * @return {String}
 *
 * @properties={typeid:24,uuid:"4E25AB1A-8857-4874-91F4-3B69E7672C67"}
 */
function getServerNameFromJdbcUrl(jdbcUrl) {
    var regex = /^jdbc:(postgresql|mysql|mariadb|sqlserver):\/\/([^:\/]+)(:\d+)?\/(.*)/;
    var match = jdbcUrl.match(regex);
    
    if (match && match[4]) {
        return match[4].split('?')[0];
    } else {
        throw new Error("Invalid JDBC URL");
    }
}
