angular.module('ui.bootstrap.typeahead', ['ui.bootstrap.position', 'ui.bootstrap.bindHtml'])

/**
 * A helper service that can parse typeahead's syntax (string provided by users)
 * Extracted to a separate service for ease of unit testing
 */
  .factory('typeaheadParser', ['$parse', function ($parse) {

  //                      00000111000000000000022200000000000000003333333333333330000000000044000
  var TYPEAHEAD_REGEXP = /^\s*(.*?)(?:\s+as\s+(.*?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+(.*)$/;

  return {
    parse:function (input) {

      var match = input.match(TYPEAHEAD_REGEXP);
      if (!match) {
        throw new Error(
          'Expected typeahead specification in form of "_modelValue_ (as _label_)? for _item_ in _collection_"' +
            ' but got "' + input + '".');
      }

      return {
        itemName:match[3],
        source:$parse(match[4]),
        viewMapper:$parse(match[2] || match[1]),
        modelMapper:$parse(match[1])
      };
    }
  };
}])

  .controller('TypeaheadController', [
             '$scope', '$compile', '$q', '$attrs', '$parse', '$element', '$position', 'typeaheadParser',
    function ($scope ,  $compile ,  $q ,  $attrs ,  $parse ,  $element ,  $position ,  typeaheadParser) {

      // This is in isolate scope
      var originalScope = $scope.$parent;

      var ctrl = this;

      //binding to a variable that indicates if matches are being retrieved asynchronously
      ctrl.setIsLoading = angular.noop;

      var appendToBody =  $attrs.typeaheadAppendToBody ? $parse($attrs.typeaheadAppendToBody) : false;

      //should first item of matches be highlighted automatically? (off by default)
      var autoHighlight = originalScope.$eval($attrs.typeaheadAutoHighlight) === true;

      //INTERNAL VARIABLES

      //model setter executed upon match selection
      var $setModelValue = $parse($attrs.ngModel).assign;

      //expressions used by typeahead
      ctrl.parserResult = typeaheadParser.parse($attrs.typeahead);

      // Called with model, itemDetails (model, {item, model, label})
      ctrl.selectListeners = [];

      // Methods that are called on query similar to ngModelController.$parsers but supports
      // promises.
      ctrl.queryParsers = [];

      // Check this value to see if it's the latest query
      var lastQuery = null;

      ctrl.setQuery = function (query) {
        lastQuery = query;
        if (!query && query !== '') {
          resetMatches();
          return;
        }

        var queryPromise = $q.when(query);

        for (var i = 0; i < ctrl.queryParsers.length; i++) {
          queryPromise = queryPromise.then(ctrl.queryParsers[i]);
        }

        queryPromise.then(function (value) {
          // async query
          if (query === lastQuery && typeof value !== 'undefined') {
            ctrl.getMatches(value);
          }
        });
      };

      var lastMatchInputValue = null;

      ctrl.getMatches = function(inputValue) {
        lastMatchInputValue = inputValue;

        var locals = {$viewValue: inputValue};
        ctrl.setIsLoading(originalScope, true);
        $q.when(ctrl.parserResult.source(originalScope, locals)).then(function(matches) {

          //it might happen that several async queries were in progress if a user were typing fast
          //but we are interested only in responses that correspond to the current view value
          if (inputValue === lastMatchInputValue) {
            if (matches.length > 0) {

              $scope.active = autoHighlight === true ? 0 : -1;
              $scope.matches.length = 0;

              //transform labels
              for(var i=0; i<matches.length; i++) {
                locals[ctrl.parserResult.itemName] = matches[i];
                $scope.matches.push({
                  label: ctrl.parserResult.viewMapper(originalScope, locals),
                  model: ctrl.parserResult.modelMapper(originalScope, locals),
                  item: matches[i]
                });
              }

              $scope.query = inputValue;
              //position pop-up with matches - we need to re-calculate its position each time we are opening a window
              //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
              //due to other elements being rendered
              $scope.position = appendToBody ? $position.offset($element) : $position.position($element);
              $scope.position.top += $element.prop('offsetHeight');
              ctrl.setIsLoading(originalScope, false);
            } else {
              resetMatches();
            }
          }
        }, function(){
          resetMatches();
        });
      };

      ctrl.inputFormatter = function (scope, locals) {
        var candidateViewValue, emptyViewValue;

        //it might happen that we don't have enough info to properly render input value
        //we need to check for this situation and simply return model value if we can't apply custom formatting
        locals[ctrl.parserResult.itemName] = locals.$model;
        candidateViewValue = ctrl.parserResult.viewMapper(scope, locals);
        locals[ctrl.parserResult.itemName] = undefined;
        emptyViewValue = ctrl.parserResult.viewMapper(scope, locals);

        return candidateViewValue !== emptyViewValue ? candidateViewValue : locals.$model;
      };

      ctrl.select = function (match) {
        $setModelValue(originalScope, match.model);
        resetMatches();

        for (var i = 0; i < ctrl.selectListeners.length; i++) {
          ctrl.selectListeners[i](match.model, match);
        }

        //return focus to the input element if a mach was selected via a mouse click event
        $element[0].focus();
      };

      resetMatches();

      function resetMatches() {
        lastQuery = null;
        lastMatchInputValue = null;
        $scope.matches = [];
        $scope.active = -1;
        ctrl.setIsLoading(originalScope, false);
      }

      ctrl._selectActive = function (activeIdx) {
        if (typeof activeIdx != 'undefined') {
          $scope.active = activeIdx;
        }
        ctrl.select($scope.matches[$scope.active]);
      };

      ctrl._nextMatch = function () {
        $scope.active = ($scope.active + 1) % $scope.matches.length;
      };

      ctrl._prevMatch = function () {
        $scope.active = ($scope.active ? $scope.active : $scope.matches.length) - 1;
      };

      //pop-up element used to display matches
      var popUpEl = angular.element('<div typeahead-popup></div>');
      //custom item template
      if (angular.isDefined($attrs.typeaheadTemplateUrl)) {
        popUpEl.attr('template-url', $attrs.typeaheadTemplateUrl);
      }

      ctrl.popUpEl = $compile(popUpEl)($scope);
    }
  ])

  .directive('typeahead', ['$compile', '$parse', '$document', 'typeaheadParser',
    function ($compile, $parse, $document, typeaheadParser) {

  var HOT_KEYS = [9, 13, 27, 38, 40];

  return {
    require: ['typeahead', 'ngModel'],
    controller: 'TypeaheadController',
    controllerAs: 'typeaheadCtrl',
    scope: {},
    link:function (scope, element, attrs, controllers) {

      var originalScope = scope.$parent;

      var typeaheadCtrl = controllers[0],
          modelCtrl = controllers[1];

      //SUPPORTED ATTRIBUTES (OPTIONS)

      var appendToBody =  attrs.typeaheadAppendToBody ? $parse(attrs.typeaheadAppendToBody) : false;

      //INTERNAL VARIABLES

      //plug into modelCtrl pipeline to open a typeahead on view changes
      modelCtrl._$setViewValue = modelCtrl.$setViewValue;
      modelCtrl.$setViewValue = function (inputValue) {

        if (inputValue) {
          typeaheadCtrl.setQuery(inputValue);
        } else {
          resetMatches();
        }

        return modelCtrl._$setViewValue(inputValue);
      };

      modelCtrl.$formatters.push(function (modelValue) {

        var locals = {
          $model: modelValue
        };

        return typeaheadCtrl.inputFormatter(originalScope, locals);
      });

      //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
      element.bind('keydown', function (evt) {

        //typeahead is open and an "interesting" key was pressed
        if (scope.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
          return;
        }



        if (evt.which === 40) {
          evt.preventDefault();
          typeaheadCtrl._nextMatch();
          scope.$digest();

        } else if (evt.which === 38) {
          evt.preventDefault();
          typeaheadCtrl._prevMatch();
          scope.$digest();

        } else if (evt.which === 13 || evt.which === 9) {
          if ( scope.active === -1 ) {
            resetMatches();
            return;
          }
          evt.preventDefault();
          scope.$apply(function () {
            typeaheadCtrl._selectActive();
          });

        } else if (evt.which === 27) {
          evt.preventDefault();
          evt.stopPropagation();

          resetMatches();
          scope.$digest();
        }
      });

      element.bind('blur', function () {
        if (!scope.mouseIsOver) {
          resetMatches();
          scope.$digest();
        }
      });

      // Keep reference to click handler to unbind it.
      var dismissClickHandler = function (evt) {
        if (element[0] !== evt.target) {
          resetMatches();
          scope.$digest();
        }
      };

      $document.bind('click', dismissClickHandler);

      originalScope.$on('$destroy', function(){
        $document.unbind('click', dismissClickHandler);
      });

      if ( appendToBody ) {
        $document.find('body').append(typeaheadCtrl.popUpEl);
      } else {
        element.after(typeaheadCtrl.popUpEl);
      }

      function resetMatches() {
        typeaheadCtrl.setQuery(null);
      }
    }
  };

}])

  .directive('typeaheadPopup', function () {
    return {
      restrict:'EA',
      /*
      scope:{
        matches:'=',
        query:'=',
        active:'=',
        position:'=',
        mouseIsOver:'=',
        select:'&'
      },
       */
      replace:true,
      templateUrl:'template/typeahead/typeahead-popup.html',
      link:function (scope, element, attrs) {

        scope.templateUrl = attrs.templateUrl;

        scope.isOpen = function () {
          return scope.matches.length > 0;
        };

        scope.isActive = function (matchIdx) {
          return scope.active == matchIdx;
        };

        scope.selectActive = function (matchIdx) {
          scope.active = matchIdx;
        };

        scope.selectMatch = function (activeIdx) {
          scope.typeaheadCtrl._selectActive(activeIdx);
        };
      }
    };
  })

  .directive('typeaheadMatch', ['$http', '$templateCache', '$compile', '$parse', function ($http, $templateCache, $compile, $parse) {
    return {
      restrict:'EA',
      scope:{
        index:'=',
        match:'=',
        query:'='
      },
      link:function (scope, element, attrs) {
        var tplUrl = $parse(attrs.templateUrl)(scope.$parent) || 'template/typeahead/typeahead-match.html';
        $http.get(tplUrl, {cache: $templateCache}).success(function(tplContent){
           element.replaceWith($compile(tplContent.trim())(scope));
        });
      }
    };
  }])

  .directive('typeaheadMinLength', [
    function () {
      return {
        restrict: 'A',
        require: 'typeahead',
        link: function (scope, element, attrs, typeaheadCtrl) {

          //minimal no of characters that needs to be entered before typeahead kicks-in
          var minSearch = scope.$eval(attrs.typeaheadMinLength) || 1;

          typeaheadCtrl.queryParsers.push(function (value) {
            if (value.length >= minSearch) {
              return value;
            }
          });

        }
      };
    }
  ])

  .directive('typeaheadWaitMs', [
             '$timeout',
    function ($timeout) {
      return {
        restrict: 'A',
        require: 'typeahead',
        link: function (scope, element, attrs, typeaheadCtrl) {

          //minimal wait time after last character typed before typehead kicks-in
          var waitTime = scope.$eval(attrs.typeaheadWaitMs) || 0;

          if (waitTime > 0) {
            //Declare the timeout promise var outside the function scope so that stacked calls can be cancelled later
            var timeoutPromise;

            typeaheadCtrl.queryParsers.push(function (value) {
              if (timeoutPromise) {
                $timeout.cancel(timeoutPromise);//cancel previous timeout
              }
              timeoutPromise = $timeout(function () {
                return value;
              }, waitTime);
              return timeoutPromise;
            });
          }

        }
      };
    }
  ])

  .directive('typeaheadOnSelect', [
             '$parse',
    function ($parse) {
      return {
        restrict: 'A',
        require: 'typeahead',
        link: function (scope, element, attrs, typeaheadCtrl) {

          //a callback executed when a match is selected
          var onSelectCallback = $parse(attrs.typeaheadOnSelect);

          typeaheadCtrl.selectListeners.push(function (model, match) {
            onSelectCallback(scope, {
              $item: match.item,
              $model: match.model,
              $label: match.label
            });
          });

        }
      };
    }
  ])


  .directive('typeaheadEditable', [
    function () {
      return {
        restrict: 'A',
        require: ['ngModel', 'typeahead'],
        link: function (scope, element, attrs, controllers) {

          var ngModelCtrl = controllers[0],
              typeaheadCtrl = controllers[1];

          //should it restrict model values to the ones selected from the popup only?
          var isEditable = scope.$eval(attrs.typeaheadEditable) !== false;

          // push instead of unshift as this has to come after the parser added by typeahead
          ngModelCtrl.$parsers.push(function (inputValue) {
            if (isEditable) {
              return inputValue;
            } else {
              if (!inputValue) {
                // Reset in case user had typed something previously.
                ngModelCtrl.$setValidity('editable', true);
                return inputValue;
              } else {
                ngModelCtrl.$setValidity('editable', false);
                return undefined;
              }
            }
          });

          typeaheadCtrl.selectListeners.push(function () {
            ngModelCtrl.$setValidity('editable', true);
          });
        }
      };
    }
  ])

  .directive('typeaheadInputFormatter', [
             '$parse',
    function ($parse) {
      return {
        restrict: 'A',
        require: 'typeahead',
        link: function (scope, element, attrs, typeaheadCtrl) {
          if (attrs.typeaheadInputFormatter) {
            typeaheadCtrl.inputFormatter = $parse(attrs.typeaheadInputFormatter);
          }
        }
      };
    }
  ])

  .directive('typeaheadLoading', [
             '$parse',
    function ($parse) {
      return {
        restrict: 'A',
        require: 'typeahead',
        link: function (scope, element, attrs, typeaheadCtrl) {
          typeaheadCtrl.setIsLoading = $parse(attrs.typeaheadLoading).assign || angular.noop;
        }
      };
    }
  ])

  .filter('typeaheadHighlight', function() {

    function escapeRegexp(queryToEscape) {
      return queryToEscape.replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1');
    }

    return function(matchItem, query) {
      matchItem = String(matchItem);
      return query ? matchItem.replace(new RegExp(escapeRegexp(query), 'gi'), '<strong>$&</strong>') : matchItem;
    };
  });
