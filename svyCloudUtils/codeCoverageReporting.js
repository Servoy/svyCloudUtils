/*
 * This file gets added as a scope to the Test Solution and contains logic needed for proper Code Coverage:
 * - CC for entity methods
 * - CC for calculations
 * - Method to store the report result when the test solution closes after a testrun
 */

/**
 * Path to the CodeCoverageReport directory
 * @private
 * @type {String}
 *
 * @properties={typeid:35,uuid:"77469B43-750C-4698-8588-BFA3560A77FD"}
 */
var reportPath = '@reportPath@'; //gets dynamically replaced with the actual reportPath during the build

/**
 * Variable for recording all coverage data
 * @public
 * @type {*}
 * 
 * @properties={typeid:35,uuid:"428BFC5E-4357-4D85-93EF-8B78BCE647D8",variableType:-4}
 */
var __coverage__ = (Function('return this'))();

/**
 * Scope initialization
 * @private
 * @properties={typeid:35,uuid:"4F5FF76F-92A1-4B0B-A034-1553B818D540",variableType:-4}
 * @SuppressWarnings (unused)
 */
var initScope = (function(){
	if (!__coverage__.__coverage__) {
		__coverage__.__coverage__ = {};
	}
	__coverage__ = __coverage__.__coverage__;
	
	initForCalcsAndEntityMethods();
	fixBaseLine();
}());

/**
 * Hook that needs to be included in the onClose event handler of the test solution, so the coverage data gets stored to disk for usage in the Code Coverage Reports
 * @public
 * @properties={typeid:24,uuid:"A132C5A0-45C9-4628-A527-3EEA18FCC913"}
 */
function storeCoverageData() {
	//Logic to write Code Coverage reports generated by instrumented .js files when running in a test client in Jenkins to disc for reporting purposes
	var filePath = reportPath + '/coverage.json'; //reportPath variable is appended to this file during the build process
	if (!application.isInDeveloper() && !plugins.file.writeTXTFile(filePath, JSON.stringify(__coverage__), 'UTF-8')) {
		application.output('Can\'t write file ' + filePath, LOGGINGLEVEL.ERROR);
	}
}

/**
 * Resets Coverage counters in baseline to zero, so files that are not executed at all report 0% coverage
 * @private
 * @properties={typeid:24,uuid:"40A24364-B670-474F-BABC-B7479EB82515"}
 */
function fixBaseLine() {
	var filePath = reportPath + '/coverage-baseline.json';
	var jsFile = plugins.file.convertToJSFile(filePath);
	if (!jsFile.exists()) {
		return;
	}
	
	var text = plugins.file.readTXTFile(jsFile);
	var data = JSON.parse(text);
	
	var keys = Object.keys(data);
	for (var i = 0; i < keys.length; i++) {
		var file = data[keys[i]];
		var statements = Object.keys(file.s);
		for (var j = 0; j < statements.length; j++) {
			file.s[statements[j]] = 0;
		}
	}
	
	plugins.file.writeTXTFile(filePath, JSON.stringify(data));
}

/**
 * @public 
 * @properties={typeid:24,uuid:"FAE15130-F5AA-431A-A9CA-A689F37CF1D3"}
 */
function initCodeCoverage() {
	application.output('initCodeCoverage called in the onSolutionOpen to setup all the vars', LOGGINGLEVEL.INFO)
}

/**
 * Dynamically filled with the init code of Istanbul taken from entity method and calculation .js files, which cannot contain variables
 * @private
 * @properties={typeid:24,uuid:"715C1077-111D-41C9-8AFE-59680B946958"}
 */
function initForCalcsAndEntityMethods(){
	//The rest of this function is appended during the build process
}