define([
	'angular'
], function(angular){
	'use strict';

	var module = angular.module('kibana.services');

	module.service('hadoopSrv', function($http, $q) {
		var baseHiveURL   = 'http://localhost:50111/templeton/v1/hive';
		var baseJobURL    = 'http://localhost:50111/templeton/v1/jobs/';
		var baseOutputURL = 'http://localhost:50070/webhdfs/v1/user/hue/';

		// this request is to initiate the hive map-reduce job
		this.getHiveJob = function(params) {
			var deferred = $q.defer();

			$http({
				method: 'POST',
				url: baseHiveURL,
				data: $.param({
					'user.name': params.user_name,
					'statusdir': params.statusdir,
					'execute'  : params.query,
				}),
				headers: {
					"Content-Type": 'application/x-www-form-urlencoded'
				}
			}).then(function (result){
			    deferred.resolve(result.data.id);
			}, function (error){
			    deferred.reject(error);
			});

			return deferred.promise;
		};

		// this request is to track hive map-reduce job
		this.getJobState = function(params) {
			var query = baseJobURL + params.id;
			var deferred = $q.defer();

			var jobComplete, exitCode;

			var jobInterval = setInterval(function () {
				$http.get(query).then(function (result) {
					jobComplete = result.data.status.jobComplete;
					if(jobComplete) {
						// check for exit code and clear interval
						clearInterval(jobInterval);
						exitCode = result.data.exitValue;
						
						var response = {
							'isOutput' : exitCode === 0
						};
						deferred.resolve(response);
					}
				}, function (error){
					deferred.reject(error);
				});
			}, params.interval);

			return deferred.promise;
		};

		// the request of downloading the response file
		this.getOutputFile = function(params) {
			var query = 'http://localhost:50070/webhdfs/v1/user/hue/' + params.statusdir + '/';
			var fileType = params.isOutput ? 'stdout' : 'stderr';
			query += fileType + '?op=OPEN';

			var deferred = $q.defer();

			$http.get(query).then(function (result){
				deferred.resolve(result);
			}, function (error){
				deferred.reject(error);
			});

			return deferred.promise;
		};
	});
});