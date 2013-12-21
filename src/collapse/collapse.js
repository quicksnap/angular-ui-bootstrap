angular.module('ui.bootstrap.collapse', [])

  .directive('collapse', ['$animate', function ($animate) {

    return {
      link: function (scope, element, attrs) {
        element.addClass('collapse');

        function expand() {
          animateStart();
          $animate.addClass(element, 'in', function () {
            // Doing height: '' to remove this property works too as "height:
            // auto" is already in the Bootstrap stylesheet but may break
            // compatibility with IE8 according to warning on
            // http://api.jquery.com/css/
            element.css({height: 'auto'});
            animateDone();
          });
        }

        function collapse() {
          animateStart();
          $animate.removeClass(element, 'in', function () {
            // Read note above about IE8
            element.css({height: '0'});
            animateDone();
          });
        }

        function animateStart() {
          element
            .removeClass('collapse')
            .addClass('collapsing');
        }

        function animateDone() {
          element
            .removeClass('collapsing')
            .addClass('collapse');
        }

        scope.$watch(attrs.collapse, function (shouldCollapse) {
          if (shouldCollapse) {
            collapse();
          } else {
            expand();
          }
        });
      }
    };
  }])

  .animation('.collapsing', function () {

    // Check for addition/removal of 'in' class
    return {
      beforeAddClass: _setZeroHeight,
      addClass: _setFullHeight,
      beforeRemoveClass: _setFullHeight,
      removeClass: _setZeroHeight
    };

    function _setFullHeight(element, className, done) {
      if (className == 'in') {
        element.css({height: element[0].scrollHeight + 'px'});
      }
      done();
    }

    function _setZeroHeight(element, className, done) {
      if (className == 'in') {
        element.css({height: '0'});
      }
      done();
    }

  })

;
