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

      var match = input.match(TYPEAHEAD_REGEXP), modelMapper, viewMapper, source;
      if (!match) {
        throw new Error(
          "Expected typeahead specification in form of '_modelValue_ (as _label_)? for _item_ in _collection_'" +
            " but got '" + input + "'.");
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

  .controller('typeaheadController', [
             '$scope', '$compile', '$q', '$attrs', '$parse', '$element', '$position', 'typeaheadParser',
    function ($scope ,  $compile ,  $q ,  $attrs ,  $parse ,  $element ,  $position ,  typeaheadParser) {

      var ctrl = this;

      //binding to a variable that indicates if matches are being retrieved asynchronously
      var isLoadingSetter = $parse($attrs.typeaheadLoading).assign || angular.noop;

      var appendToBody =  $attrs.typeaheadAppendToBody ? $parse($attrs.typeaheadAppendToBody) : false;

      //INTERNAL VARIABLES

      //model setter executed upon match selection
      var $setModelValue = $parse($attrs.ngModel).assign;

      //expressions used by typeahead
      var parserResult = typeaheadParser.parse($attrs.typeahead);

      //create a child scope for the typeahead directive so we are not polluting original scope
      //with typeahead-specific data (matches, query etc.)
      var taScope = this.taScope = $scope.$new();
      taScope.typeaheadCtrl = this;

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
        isLoadingSetter($scope, true);
        $q.when(parserResult.source($scope, locals)).then(function(matches) {

          //it might happen that several async queries were in progress if a user were typing fast
          //but we are interested only in responses that correspond to the current view value
          if (inputValue === lastMatchInputValue) {
            if (matches.length > 0) {

              ctrl.activeIdx = 0;
              ctrl.matches.length = 0;

              //transform labels
              for(var i=0; i<matches.length; i++) {
                locals[parserResult.itemName] = matches[i];
                ctrl.matches.push({
                  label: parserResult.viewMapper($scope, locals),
                  model: parserResult.modelMapper($scope, locals),
                  item: matches[i]
                });
              }

              ctrl.query = inputValue;
              //position pop-up with matches - we need to re-calculate its position each time we are opening a window
              //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
              //due to other elements being rendered
              ctrl.position = appendToBody ? $position.offset($element) : $position.position($element);
              ctrl.position.top = ctrl.position.top + $element.prop('offsetHeight');
              isLoadingSetter($scope, false);
            } else {
              resetMatches();
            }
          }
        }, function(){
          resetMatches();
        });
      };

      ctrl.select = function (match) {
        $setModelValue($scope, match.model);
        resetMatches();

        for (var i = 0; i < ctrl.selectListeners.length; i++) {
          ctrl.selectListeners[i](match.model, match);
        }

        //return focus to the input element if a mach was selected via a mouse click event
        $element[0].focus();
      };

      ctrl._selectActive = function (activeIdx) {
        if (typeof activeIdx != 'undefined') {
          ctrl.activeIdx = activeIdx;
        }
        ctrl.select(ctrl.matches[ctrl.activeIdx]);
      };

      ctrl._nextMatch = function () {
        ctrl.activeIdx = (ctrl.activeIdx + 1) % ctrl.matches.length;
      };

      ctrl._prevMatch = function () {
        ctrl.activeIdx = (ctrl.activeIdx ? ctrl.activeIdx : ctrl.matches.length) - 1;
      };

      resetMatches();

      //pop-up element used to display matches
      var popUpEl = angular.element('<div typeahead-popup></div>');
      popUpEl.attr({
        typeaheadCtrl: 'typeaheadCtrl',
        matches: 'typeaheadCtrl.matches',
        active: 'typeaheadCtrl.activeIdx',
        select: 'typeaheadCtrl._selectActive(activeIdx)',
        query: 'typeaheadCtrl.query',
        position: 'typeaheadCtrl.position'
      });
      //custom item template
      if (angular.isDefined($attrs.typeaheadTemplateUrl)) {
        popUpEl.attr('template-url', $attrs.typeaheadTemplateUrl);
      }

      function resetMatches() {
        lastQuery = null;
        lastMatchInputValue = null;
        ctrl.matches = [];
        ctrl.activeIdx = -1;
        isLoadingSetter($scope, false);
      }

      ctrl.popUpEl = $compile(popUpEl)(taScope);
    }
  ])

  .directive('typeahead', ['$compile', '$parse', '$q', '$timeout', '$document', 'typeaheadParser',
    function ($compile, $parse, $q, $timeout, $document, typeaheadParser) {

  var HOT_KEYS = [9, 13, 27, 38, 40];

  return {
    require: ['typeahead', 'ngModel'],
    controller: 'typeaheadController',
    link:function (originalScope, element, attrs, controllers) {

      var typeaheadCtrl = controllers[0],
          modelCtrl = controllers[1],
          scope = typeaheadCtrl.taScope;

      //SUPPORTED ATTRIBUTES (OPTIONS)

      //minimal no of characters that needs to be entered before typeahead kicks-in
      var minSearch = originalScope.$eval(attrs.typeaheadMinLength) || 1;

      //minimal wait time after last character typed before typehead kicks-in
      var waitTime = originalScope.$eval(attrs.typeaheadWaitMs) || 0;

      var inputFormatter = attrs.typeaheadInputFormatter ? $parse(attrs.typeaheadInputFormatter) : undefined;

      var appendToBody =  attrs.typeaheadAppendToBody ? $parse(attrs.typeaheadAppendToBody) : false;

      //INTERNAL VARIABLES

      //expressions used by typeahead
      var parserResult = typeaheadParser.parse(attrs.typeahead);

      //Declare the timeout promise var outside the function scope so that stacked calls can be cancelled later 
      var timeoutPromise;

      //plug into $parsers pipeline to open a typeahead on view changes initiated from DOM
      //$parsers kick-in on all the changes coming from the view as well as manually triggered by $setViewValue
      modelCtrl.$parsers.unshift(function (inputValue) {

        if (inputValue && inputValue.length >= minSearch) {
          if (waitTime > 0) {
            if (timeoutPromise) {
              $timeout.cancel(timeoutPromise);//cancel previous timeout
            }
            timeoutPromise = $timeout(function () {
              typeaheadCtrl.setQuery(inputValue);
            }, waitTime);
          } else {
            typeaheadCtrl.setQuery(inputValue);
          }
        } else {
          resetMatches();
        }

        return inputValue;
      });

      modelCtrl.$formatters.push(function (modelValue) {

        var candidateViewValue, emptyViewValue;
        var locals = {};

        if (inputFormatter) {

          locals['$model'] = modelValue;
          return inputFormatter(originalScope, locals);

        } else {

          //it might happen that we don't have enough info to properly render input value
          //we need to check for this situation and simply return model value if we can't apply custom formatting
          locals[parserResult.itemName] = modelValue;
          candidateViewValue = parserResult.viewMapper(originalScope, locals);
          locals[parserResult.itemName] = undefined;
          emptyViewValue = parserResult.viewMapper(originalScope, locals);

          return candidateViewValue!== emptyViewValue ? candidateViewValue : modelValue;
        }
      });

      //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
      element.bind('keydown', function (evt) {

        //typeahead is open and an "interesting" key was pressed
        if (typeaheadCtrl.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
          return;
        }

        evt.preventDefault();

        if (evt.which === 40) {
          typeaheadCtrl._nextMatch();
          scope.$digest();

        } else if (evt.which === 38) {
          typeaheadCtrl._prevMatch();
          scope.$digest();

        } else if (evt.which === 13 || evt.which === 9) {
          scope.$apply(function () {
            typeaheadCtrl._selectActive();
          });

        } else if (evt.which === 27) {
          evt.stopPropagation();

          resetMatches();
          scope.$digest();
        }
      });

      element.bind('blur', function () {
        resetMatches();
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
      scope:{
        matches:'=',
        query:'=',
        active:'=',
        position:'=',
        select:'&'
      },
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
          scope.select({activeIdx:activeIdx});
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

  .filter('typeaheadHighlight', function() {

    function escapeRegexp(queryToEscape) {
      return queryToEscape.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
    }

    return function(matchItem, query) {
      return query ? matchItem.replace(new RegExp(escapeRegexp(query), 'gi'), '<strong>$&</strong>') : matchItem;
    };
  });