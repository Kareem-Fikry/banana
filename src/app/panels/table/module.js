/*

  ## Table

  ### Parameters
  * size :: Number of events per page to show
  * pages :: Number of pages to show. size * pages = number of cached events.
             Bigger = more memory usage byh the browser
  * offset :: Position from which to start in the array of hits
  * sort :: An array with 2 elements. sort[0]: field, sort[1]: direction ('asc' or 'desc')
  * style :: hash of css properties
  * fields :: columns to show in table
  * overflow :: 'height' or 'min-height' controls wether the row will expand (min-height) to
                to fit the table, or if the table will scroll to fit the row (height)
  * trimFactor :: If line is > this many characters, divided by the number of columns, trim it.
  * sortable :: Allow sorting?
  * spyable :: Show the 'eye' icon that reveals the last ES query for this panel

*/
define([
  'angular',
  'app',
  'underscore',
  'kbn',
  'moment',
  'jsPanel'
  // 'text!./pagination.html',
  // 'text!partials/querySelect.html'
],
function (angular, app, _, kbn, moment, jsPanel) {
  'use strict';

  var module = angular.module('kibana.panels.table', []);
  app.useModule(module);
  module.controller('table', function($rootScope, $scope, $http, $timeout, $window, $q, fields, querySrv, dashboard, filterSrv, hadoopSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {
          title:'Fields',
          src: 'app/panels/table/fields.html'
        },
        {
          title:'Paging',
          src: 'app/panels/table/pagination.html'
        },
        {
          title:'Workflow',
          src: 'app/panels/table/workflow.html'
        },
        {
          title:'Queries',
          src: 'app/partials/querySelect.html'
        }
      ],
      exportfile: true,
      status: "Stable",
      description: "A paginated table of records matching your query (including any filters that may have been applied). Click on a row to expand it and review all of the fields associated with that document. Provides the capability to export your result set to CSV, XML or JSON for further processing using other systems."
    };

    // Set and populate defaults
    var _d = {
      status  : "Stable",
      queries     : {
        mode        : 'all',
        ids         : [],
        query       : '*:*',
        basic_query : '',
        custom      : ''
      },
      workflow: {
        title     : 'Hive Query',
        execute   : 'select * from users where swid = ',
        statusdir : 'bananaOut',
        interval  : 3000
      },
      size    : 100, // Per page
      pages   : 5,   // Pages available
      offset  : 0,
      sort    : ['event_timestamp','desc'],
      group   : "default",
      style   : {'font-size': '9pt'},
      overflow: 'min-height',
      fields  : [],
      important_fields : [],
      highlight : [],
      sortable: true,
      header  : true,
      paging  : true,
      field_list: true,
      trimFactor: 300,
      normTimes : true,
      spyable : true,
      saveOption : 'json',
      exportSize: 100,
      exportAll: true,
      displayLinkIcon: true,
      imageFields : [],      // fields to be displayed as <img>
      imgFieldWidth: 'auto', // width of <img> (if enabled)
      imgFieldHeight: '85px' // height of <img> (if enabled)
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.Math = Math;
      // Solr
      $scope.sjs = $scope.sjs || sjsResource(dashboard.current.solr.server + dashboard.current.solr.core_name); // jshint ignore: line
      $scope.$on('refresh',function(){$scope.get_data();});
      $scope.panel.exportSize = $scope.panel.size * $scope.panel.pages; 
      $scope.fields = fields;
      
      // Backward compatibility with old dashboards without important fields
      // Set important fields to all fields if important fields array is empty
      if (_.isEmpty($scope.panel.important_fields)) {
        $scope.panel.important_fields = fields.list;
      }
      $scope.get_data();
    };

    $scope.percent = kbn.to_percent;

    $scope.toggle_micropanel = function(field,groups) {
      var docs = _.map($scope.data,function(_d){return _d.kibana._source;});
      var topFieldValues = kbn.top_field_values(docs,field,10,groups);
      $scope.micropanel = {
        field: field,
        grouped: groups,
        values : topFieldValues.counts,
        hasArrays : topFieldValues.hasArrays,
        related : kbn.get_related_fields(docs,field),
        count: _.countBy(docs,function(doc){return _.contains(_.keys(doc),field);})['true']
      };
    };

    $scope.micropanelColor = function(index) {
      var _c = ['bar-success','bar-warning','bar-danger','bar-info','bar-primary'];
      return index > _c.length ? '' : _c[index];
    };

    $scope.set_sort = function(field) {
      if($scope.panel.sort[0] === field) {
        $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
      } else {
        $scope.panel.sort[0] = field;
      }
      $scope.get_data();
    };

    $scope.toggle_field = function(field) {
      if (_.indexOf($scope.panel.fields,field) > -1) {
        $scope.panel.fields = _.without($scope.panel.fields,field);
      } else {
        $scope.panel.fields.push(field);
      }
    };

    // Toggle important field that will appear to the left of table panel
    $scope.toggle_important_field = function(field) {
      if (_.indexOf($scope.panel.important_fields,field) > -1) {
        $scope.panel.important_fields = _.without($scope.panel.important_fields,field);
      } else {
        $scope.panel.important_fields.push(field);
      }
    };

    $scope.toggle_highlight = function(field) {
      if (_.indexOf($scope.panel.highlight,field) > -1) {
        $scope.panel.highlight = _.without($scope.panel.highlight,field);
      } else {
        $scope.panel.highlight.push(field);
      }
    };

    $scope.toggle_details = function(row) {
      row.kibana.details = row.kibana.details ? false : true;
      row.kibana.view = row.kibana.view || 'table';
      //row.kibana.details = !row.kibana.details ? $scope.without_kibana(row) : false;
    };

    $scope.page = function(page) {
      $scope.panel.offset = page*$scope.panel.size;
      $scope.get_data();
    };

    $scope.build_search = function(field,value,negate) {
      var query;
      // This needs to be abstracted somewhere
      if(_.isArray(value)) {
        // TODO: I don't think Solr has "AND" operator in query.
        query = "(" + _.map(value,function(v){return angular.toJson(v);}).join(" AND ") + ")";
      } else if (_.isUndefined(value)) {
        query = '*:*';
        negate = !negate;
      } else {
        query = angular.toJson(value);
      }
      // TODO: Need to take a look here, not sure if need change.
      filterSrv.set({type:'field',field:field,query:query,mandate:(negate ? 'mustNot':'must')});

      $scope.panel.offset = 0;
      dashboard.refresh();
    };

    $scope.fieldExists = function(field,mandate) {
      // TODO: Need to take a look here.
      filterSrv.set({type:'exists',field:field,mandate:mandate});
      dashboard.refresh();
    };

    $scope.get_data = function(segment,query_id) {
      $scope.panel.error =  false;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }
      $scope.panelMeta.loading = true;
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      // What this segment is for? => to select which indices to query.
      var _segment = _.isUndefined(segment) ? 0 : segment;
      $scope.segment = _segment;

      $scope.sjs.client.server(dashboard.current.solr.server + dashboard.current.solr.core_name);

      var request = $scope.sjs.Request().indices(dashboard.indices[_segment]);

      $scope.panel_request = request;

      var fq = '&' + filterSrv.getSolrFq();
      var query_size = $scope.panel.size * $scope.panel.pages;
      var wt_json = '&wt=json';
      var rows_limit;
      var sorting = '';

      if ($scope.panel.sort[0] !== undefined && $scope.panel.sort[1] !== undefined && $scope.panel.sortable) {
        sorting = '&sort=' + $scope.panel.sort[0] + ' ' + $scope.panel.sort[1];
      }

      // set the size of query result
      if (query_size !== undefined && query_size !== 0) {
        rows_limit = '&rows=' + query_size;
      } else { // default
        rows_limit = '&rows=25';
      }

      // Set the panel's query
      $scope.panel.queries.basic_query = querySrv.getQuery(0) + fq + sorting;
      $scope.panel.queries.query = $scope.panel.queries.basic_query + wt_json + rows_limit;

      // Set the additional custom query
      if ($scope.panel.queries.custom != null) {
        request = request.setQuery($scope.panel.queries.query + $scope.panel.queries.custom);
      } else {
        request = request.setQuery($scope.panel.queries.query);
      }

      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        $scope.panelMeta.loading = false;

        if(_segment === 0) {
          $scope.hits = 0;
          $scope.data = [];
          query_id = $scope.query_id = new Date().getTime();
        } else {
          // Fix BUG with wrong total event count.
          $scope.data = [];
        }

        // Check for error and abort if found
        if(!(_.isUndefined(results.error))) {
          $scope.panel.error = $scope.parse_error(results.error.msg); // There's also results.error.code
          return;
        }

        // Check that we're still on the same query, if not stop
        if($scope.query_id === query_id) {
          $scope.data = $scope.data.concat(_.map(results.response.docs, function(hit) {
            var _h = _.clone(hit);
            _h.kibana = {
              _source : kbn.flatten_json(hit),
              highlight : kbn.flatten_json(hit.highlight||{})
            };

            return _h;
          }));

          // Solr does not need to accumulate hits count because it can get total count
          // from a single faceted query.
          $scope.hits = results.response.numFound;

          // Keep only what we need for the set
          $scope.data = $scope.data.slice(0,$scope.panel.size * $scope.panel.pages);
        } else {
          return;
        }

        // If we're not sorting in reverse chrono order, query every index for
        // size*pages results
        // Otherwise, only get size*pages results then stop querying
        if (($scope.data.length < $scope.panel.size*$scope.panel.pages ||
          !((_.contains(filterSrv.timeField(),$scope.panel.sort[0])) && $scope.panel.sort[1] === 'desc')) &&
          _segment+1 < dashboard.indices.length) {
          $scope.get_data(_segment+1,$scope.query_id);
        }

      });
    };

    $scope.exportfile = function(filetype) {
      var omitHeader = '&omitHeader=true';
      var rows_limit = '&rows=' + ($scope.panel.exportSize || ($scope.panel.size * $scope.panel.pages));
      var fl = '';
      if (!$scope.panel.exportAll) {
          fl = '&fl=';
          for(var i = 0; i < $scope.panel.fields.length; i++) {
              fl += $scope.panel.fields[i] + (i !== $scope.panel.fields.length - 1 ? ',' : '');
          }
      }
      var exportQuery = $scope.panel.queries.basic_query + '&wt=' + filetype + omitHeader + rows_limit + fl;
      var request = $scope.panel_request;

      if ($scope.panel.queries.custom != null) {
        request = request.setQuery(exportQuery + $scope.panel.queries.custom);
      } else {
        request = request.setQuery(exportQuery);
      }
      
      var response = request.doSearch();

      response.then(function(response) {
          var blob; // the file to be written
          // TODO: manipulating solr requests
          // pagination (batch downloading)
          // example: 1,000,000 rows will explode the memory !
          if(filetype === 'json') {
              blob = new Blob([angular.toJson(response,true)], {type: "application/json;charset=utf-8"});
          } else if(filetype === 'csv') {
              blob = new Blob([response.toString()], {type: "text/csv;charset=utf-8"});
          } else if(filetype === 'xml'){
              blob = new Blob([response.toString()], {type: "application/xml;charset=utf-8"});
          } else {
              // incorrect file type
              alert('incorrect file type');
              return false;
          }
          // from filesaver.js
          window.saveAs(blob, "table"+"-"+new Date().getTime()+"."+filetype);
          return true;
      });
    };

    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.without_kibana = function (row) {
      var _c = _.clone(row);
      delete _c.kibana;
      return _c;
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
    };

    $scope.locate = function(obj, path) {
      path = path.split('.');
      var arrayPattern = /(.+)\[(\d+)\]/;
      for (var i = 0; i < path.length; i++) {
        var match = arrayPattern.exec(path[i]);
        if (match) {
          obj = obj[match[1]][parseInt(match[2],10)];
        } else {
          obj = obj[path[i]];
        }
      }
      return obj;
    };

    $scope.run_workflow = function(field, value, entry) {
      console.log('field =',field,'value =',value,'workflow.action =',$scope.panel.workflow.action,'workflow.title=',$scope.panel.workflow.title);

      var panel = $.jsPanel({
        title      : "Initialize Hive Job",
        theme      : "primary",
        content    : "<div style='margin: 0 auto;'><center><h5>Initializing Hive Map Reduce Job</h5><img src='img/processing.gif'></center></div>",
        overflow   : "scroll",
        position   : "center",
        size       : {width: 480, height: 360}
      });

      var query = $scope.panel.workflow.execute + (entry.swid.replace('{', "'").replace('}', "'"));

      var params = {
        'user_name': dashboard.current.hadoop.hive_webhcat_user,
        'statusdir': $scope.panel.workflow.statusdir,
        'query'    : query
      }

      hadoopSrv.getHiveJob(params)
        .then(function (result) {
          params = {
            'id'       : result,
            'interval' : $scope.panel.workflow.interval
          };
          panel.title('Running Map/Reduce Hive Queries');
          panel.content.html('<div style=\'margin: 0 auto;\'><center><h5>Running Map Reduce Hive Queries</h5><img src=\'img/processing.gif\'></center></div>');
          return hadoopSrv.getJobState(params);
      }).then(function (result) {
          params = {
            'statusdir': $scope.panel.workflow.statusdir,
            'isOutput' : result.isOutput
          };
          return hadoopSrv.getOutputFile(params);
      }).then(function (result) {
        panel.title('Queries Result');
        var data =  $scope.prepareHiveData(result);

        var template;
        if(result.isOutput) {
          template = angular.element('<table class="table table-striped"><thead><tr><th>#</th><th>Swid</th><th>Birth Date</th><th>Gender</th></tr></thead><tbody><tr ng-repeat="entry in jsPanelList"><td>{{$index + 1}}</td><td>{{entry.swid}}</td><td>{{entry.bdate}}</td><td>{{entry.gender}}</td></tr></tbody></table>');
        } else {
          template = angular.element('<div>{{jsPanelList}}</div>');
        }
        panel.content.html(template);

        var injector = panel.injector();

        var divs = panel.content.children();
        var newDiv = angular.element(divs[divs.length - 1]);

        var scope = newDiv.scope();
        scope.jsPanelList = data;

        var compile = injector.get('$compile');
        compile(newDiv)(scope);

        $timeout(function() {
          scope.$apply();
        });
      });
    };

    $scope.prepareHiveData = function (result) {
      var outputString = result.data.toString();
      if(result.isOutput){
        var results = outputString.split('\n');
        var output = [];
        for(var i = 0; i < results.length; i++) {
          var entry = results[i].split('\t');
          var row = {
            swid  : entry[0],
            bdate : entry[1],
            gender: entry[2]
          };
          output.push(row);
        }
        return output;
      } else {
        return outputString;
      }
    };
  });

  // This also escapes some xml sequences
  module.filter('tableHighlight', function() {
    return function(text) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.toString().
          replace(/&/g, '&amp;').
          replace(/</g, '&lt;').
          replace(/>/g, '&gt;').
          replace(/\r?\n/g, '<br/>').
          replace(/@start-highlight@/g, '<code class="highlight">').
          replace(/@end-highlight@/g, '</code>');
      }
      return '';
    };
  });

  module.filter('tableTruncate', function() {
    return function(text,length,factor,field,imageFields) {
      // If image field, then do not truncate, otherwise we will get invalid URIs.
      if (typeof field !== 'undefined' && imageFields.length>0 && _.contains(imageFields, field)) {
        return text;
      }

      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.length > length/factor ? text.substr(0,length/factor)+'...' : text;
      }
      return '';
    };
  });

  module.filter('tableJson', function() {
    var json;
    return function(text,prettyLevel) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        json = angular.toJson(text,prettyLevel > 0 ? true : false);
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if(prettyLevel > 1) {
          /* jshint maxlen: false */
          json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'number';
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = 'key strong';
              } else {
                cls = '';
              }
            } else if (/true|false/.test(match)) {
              cls = 'boolean';
            } else if (/null/.test(match)) {
              cls = 'null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
          });
        }
        return json;
      }
      return '';
    };
  });

  // WIP
  module.filter('tableFieldFormat', function(fields){
    return function(text,field,event,scope) {
      var type;
      if(
        !_.isUndefined(fields.mapping[event._index]) &&
        !_.isUndefined(fields.mapping[event._index][event._type])
      ) {
        type = fields.mapping[event._index][event._type][field]['type'];
        if(type === 'date' && scope.panel.normTimes) {
          return moment(text).format('YYYY-MM-DD HH:mm:ss');
        }
      }
      return text;
    };
  });

  // This filter will check the input field to see if it should be displayed as <img src="data">
  module.filter('tableDisplayImageField', function() {
    return function(data, field, imageFields, width, height) {
      if (typeof field !== 'undefined' && imageFields.length>0 && _.contains(imageFields, field)) {
        return '<img style="width:' + width + '; height:' + height + ';" src="'+data+'">';
      }
      return data;
    };
  });
});
