/**
 * Method to copy all jasperreports that are located in the reports folder to the jasperreport location on the server.
 * @public
 * @properties={typeid:24,uuid:"D9BBFECF-49BF-4F62-B2D8-A13B1234C5DB"}
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
 * @properties={typeid:24,uuid:"36E4C256-8D63-4A60-9C08-12902328516F"}
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
 * @properties={typeid:24,uuid:"6E4BCC0B-67F2-4156-96BC-D1B340CB0130"}
 */
function isPostgresDB(dbName) {
	return databaseManager.getDatabaseProductName(dbName).match('postgres') ? true : false;
}

/**
 * @enum
 * @properties={typeid:35,uuid:"4BE44304-B2C2-4EFD-96B5-487052500BAE",variableType:-4}
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
 * @properties={typeid:24,uuid:"0AAF4E9B-20E0-440E-ADB9-96CE939A5AE9"}
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
	

	for(var dbNameIndex in allVersionsDBNames) {
		var currentDBVersionName = allVersionsDBNames[dbNameIndex];
		var nextVersion = 0;
		//Create 2 new arrays with only the sql files needed for this database
		var foundVersionsForDBName = foundVersions.filter(/**@param {parseMediaDBFile} item */function(item) {
			return item.dbServer == currentDBVersionName;
		})
		
		var foundRepeatsForDBName = foundRepeats.filter(/**@param {parseMediaDBFile} item */function(item) {
			return item.dbServer == currentDBVersionName;
		})
		while (foundVersionsForDBName.length > 0 || foundRepeatsForDBName.length > 0) {
			nextVersion++;
			if (foundVersionsForDBName.length > 0) {
				var versionFile = foundVersionsForDBName[0];
				if (versionFile.version == nextVersion) {
					getAllDBs(versionFile.dbServer).forEach(function(dbServerName) {
						createVersionTable(dbServerName, versionTableName);
						var currentVersion = getCurrentVersion(dbServerName, versionTableName);
						if (versionFile.version > currentVersion) {
							if (!plugins.rawSQL.executeSQL(dbServerName, '/*IGNORE-SQL-TIMING-LOGGING*/\n' + versionFile.getFileData())) {
								throw new Error('Failed to run version migration SQL FILE: ' + versionFile.name + ' \n' + plugins.rawSQL.getException());
							} else {
								getTableNamesDataChangesAndTriggerFlush(versionFile.getFileData(), dbServerName)
							}
							setCurrentVersion(nextVersion, dbServerName, versionTableName);
						}
					})
					foundVersionsForDBName.shift();
				}
	
				if (foundRepeatsForDBName.length > 0) {
					var repeatFile = foundRepeatsForDBName[0];
					if (repeatFile.version == nextVersion) {
						getAllDBs(repeatFile.dbServer).forEach(function(dbServerName) {
							if (!plugins.rawSQL.executeSQL(dbServerName, '/*IGNORE-SQL-TIMING-LOGGING*/\n' + repeatFile.getFileData())) {
								throw new Error('Failed to run repeat migration SQL FILE: ' + repeatFile.name + ' \n' + plugins.rawSQL.getException());
							} else {
								getTableNamesDataChangesAndTriggerFlush(repeatFile.getFileData(), dbServerName)
							}
						})
						foundRepeatsForDBName.shift();
					}
				}
			}
		}
	}

	//Reload datamodel for all servers
	if (!application.isInDeveloper()) {
		var allServers = plugins.maintenance.getServerNames(true);
		for (var i in allServers) {
			plugins.maintenance.getServer(allServers[i]).reloadDataModel();
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

	   Object.keys(tableNames).forEach(function(tableName) {
		   if(databaseManager.getTable(serverName,tableName)) {
			   plugins.rawSQL.flushAllClientsCache(serverName,tableName);
		   }
	   })
	}

/**
 * @private
 * @param {String} mainDB
 * @return {Array<String>}
 *
 * @properties={typeid:24,uuid:"B3FABE27-0A45-4FF0-8EB4-987CEE7D577D"}
 */
function getAllDBs(mainDB) {
	return [mainDB].concat(databaseManager.getDataModelClonesFrom(mainDB));
}

/**
 * @private
 * @param {String} serverName
 * @param {String} [tableName]
 *
 * @properties={typeid:24,uuid:"9AEC1FEC-4653-44CE-BE95-E63358B6C2BC"}
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
 * @properties={typeid:24,uuid:"DE8A7943-F805-48B4-97C8-A593AD27F7F9"}
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
 * @properties={typeid:24,uuid:"AD19F72E-FB45-47AE-8986-2C80B0AE951D"}
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
	} else {
		setServoyProperty(serverName.toUpperCase() + '.DB_VERSION', versionNumber.toString());
	}
}

/**
 * @protected
 * @constructor
 * @param {JSMedia} media
 * @properties={typeid:24,uuid:"DF868CC5-02DC-4969-9808-E8085043FD5A"}
 * @param {String} migrationFilesFolder
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
		if (this.name.match(new RegExp("^" + migrationFilesFolder))) {
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
 * @properties={typeid:24,uuid:"9F07B7DD-D1BE-4FE3-9EBB-D4F9B489667C"}
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
 * @properties={typeid:24,uuid:"4972F6EF-56DA-4A3E-9279-2F02B26D671E"}
 */
function getServoyProperty(name) {
	var value = Packages.com.servoy.j2db.util.Settings.getInstance().get(name);
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
 * @properties={typeid:24,uuid:"A272EF15-EF8E-486C-9CF6-6C118EC5BD9D"}
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
 * @properties={typeid:24,uuid:"608BEC9A-238A-4427-ACBD-14374AA11FAE"}
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
 * @param {String} value
 *
 * @properties={typeid:24,uuid:"574A1354-376C-4568-B39D-7B96093C450C"}
 */
function setServoyProperty(name, value) {
	var instance = Packages.com.servoy.j2db.util.Settings.getInstance();
	instance.put(name, value);
	instance.save();
}
